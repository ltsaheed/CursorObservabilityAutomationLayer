import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runCodeAgent } from "./codeAgent.js";
import { loadInstrumentConfig, resolveMixpanelEnv } from "./config.js";
import { runDashboardAgent } from "./dashboardAgent.js";
import { parseRepoSlug, syncPrComment } from "./github.js";
import { runMixpanelDeploy } from "./mixpanelDeploy.js";
import { runPreScan } from "./preScan.js";
import { runStandardsReviewLoop, StandardsReviewError } from "./standardsReviewLoop.js";
import { createProgressReporter } from "./progressReporter.js";
import type { IFinalResult, IRunOptions } from "./types.js";

const loadFileContents = (
  workspaceRoot: string,
  changedFiles: string[],
): Map<string, string> => {
  const contents = new Map<string, string>();

  for (const relativePath of changedFiles) {
    try {
      const absolutePath = join(workspaceRoot, relativePath);
      contents.set(relativePath, readFileSync(absolutePath, "utf8"));
    } catch {
      continue;
    }
  }

  return contents;
};

const resolveChangedFiles = (
  options: IRunOptions,
  configPath: string,
): string[] => {
  if (options.changedFiles && options.changedFiles.length > 0) {
    return options.changedFiles;
  }

  const config = loadInstrumentConfig(configPath);

  return [`${config.paths.pages}/CheckoutRetryPage.tsx`];
};

export const runPipeline = async (options: IRunOptions): Promise<IFinalResult> => {
  const reporter = createProgressReporter();
  const config = loadInstrumentConfig(options.config);
  const changedFiles = resolveChangedFiles(options, options.config);
  const fileContents = loadFileContents(options.workspaceRoot, changedFiles);

  reporter.phaseStart("pre-scan");
  const assessment = runPreScan(changedFiles, fileContents, config, options.workspaceRoot);
  reporter.setAssessment(assessment);
  reporter.decision("pre-scan", "Assessment", assessment.summary);
  reporter.phaseComplete("pre-scan", "complete");

  let commentUrl: string | undefined;

  if (options.repo && options.prNumber && process.env.GITHUB_TOKEN) {
    reporter.phaseStart("github-comment");

    try {
      commentUrl = await syncPrComment(
        {
          token: process.env.GITHUB_TOKEN,
          repo: parseRepoSlug(options.repo),
          prNumber: options.prNumber,
        },
        reporter.getState(),
      );
      reporter.decision("github-comment", "Updated", "Sticky PR comment synced");
      reporter.phaseComplete("github-comment", "complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub comment sync failed";
      reporter.log("github-comment", message, "error");
      reporter.phaseComplete("github-comment", "failed");
    }
  } else {
    reporter.phaseStart("github-comment");
    reporter.decision(
      "github-comment",
      "Skipped",
      "Missing repo/prNumber/GITHUB_TOKEN",
    );
    reporter.phaseComplete("github-comment", "skipped");
  }

  const codeAgentResult = await runCodeAgent({
    prUrl: options.prUrl,
    workspaceRoot: options.workspaceRoot,
    assessment,
    dryRun: options.dryRun,
    skipCodeAgent: options.skipCodeAgent,
    reporter,
  });

  let report = codeAgentResult?.report;
  let standardsReview;

  if (report) {
    try {
      const reviewLoopResult = await runStandardsReviewLoop({
        workspaceRoot: options.workspaceRoot,
        assessment,
        report,
        codeAgentId: codeAgentResult?.agentId,
        dryRun: options.dryRun,
        reporter,
      });
      report = reviewLoopResult.report;
      standardsReview = reviewLoopResult.review;
      reporter.setStandardsReview(standardsReview);
    } catch (error) {
      if (error instanceof StandardsReviewError) {
        reporter.setStandardsReview({
          passed: false,
          issues: error.issues,
          summary: error.message,
          decisions: [],
        });
        report = undefined;
      } else {
        throw error;
      }
    }
  }

  let dashboardPlan;

  if (report) {
    dashboardPlan = await runDashboardAgent(report, {
      dryRun: options.dryRun,
      reporter,
    });
  } else {
    reporter.phaseStart("dashboard-agent");
    reporter.decision(
      "dashboard-agent",
      "Skipped",
      "No instrumentation report available",
    );
    reporter.phaseComplete("dashboard-agent", "skipped");
  }

  const mixpanelEnv = resolveMixpanelEnv(config);
  let deployResult = null;

  if (dashboardPlan) {
    deployResult = await runMixpanelDeploy({
      plan: dashboardPlan,
      envConfig: mixpanelEnv,
      dashboardName: config.mixpanel?.dashboardName,
      dryRun: options.dryRun,
      reportsOnly: options.reportsOnly,
      reporter,
    });
  }

  if (commentUrl && options.repo && options.prNumber && process.env.GITHUB_TOKEN) {
    try {
      commentUrl = await syncPrComment(
        {
          token: process.env.GITHUB_TOKEN,
          repo: parseRepoSlug(options.repo),
          prNumber: options.prNumber,
        },
        reporter.getState(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Final comment sync failed";
      reporter.log("github-comment", message, "warn");
    }
  }

  await reporter.finalize();

  return {
    assessment,
    report: report ?? undefined,
    standardsReview,
    dashboardPlan,
    deployResult: deployResult ?? undefined,
    commentUrl,
    dryRun: options.dryRun,
  };
};
