import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runCodeAgent } from "./codeAgent.js";
import { loadInstrumentConfig, resolveMixpanelEnv } from "./config.js";
import { runDashboardAgent } from "./dashboardAgent.js";
import { computeOverallStatus, parseRepoSlug, syncPrComment } from "./github.js";
import { syncReviewComments } from "./reviewComments.js";
import { runMixpanelDeploy } from "./mixpanelDeploy.js";
import { runPreScan } from "./preScan.js";
import { runStandardsReviewLoop, StandardsReviewError } from "./standardsReviewLoop.js";
import { createProgressReporter } from "./progressReporter.js";
import type { IFinalResult, IRunMetadata, IRunOptions } from "./types.js";

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

const buildRunMetadata = (overallStatus: IRunMetadata["overallStatus"]): IRunMetadata => {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY ?? "local/run";
  const runUrl =
    runId === "local"
      ? "#"
      : `${serverUrl}/${repository}/actions/runs/${runId}`;

  return {
    runId,
    runUrl,
    runAttempt,
    updatedAt: new Date().toISOString(),
    overallStatus,
  };
};

const syncGithubFeedback = async (options: {
  runOptions: IRunOptions;
  reporter: ReturnType<typeof createProgressReporter>;
  mixpanelProjectId?: string;
  mixpanelWorkspaceId?: string;
  report?: IFinalResult["report"];
}): Promise<string | undefined> => {
  const { runOptions, reporter, mixpanelProjectId, mixpanelWorkspaceId, report } = options;

  if (!runOptions.repo || !runOptions.prNumber || !process.env.GITHUB_TOKEN) {
    reporter.phaseStart("github-comment");
    reporter.decision(
      "github-comment",
      "Skipped",
      "Missing repo/prNumber/GITHUB_TOKEN",
    );
    reporter.phaseComplete("github-comment", "skipped");

    return undefined;
  }

  reporter.phaseStart("github-comment");

  const githubContext = {
    token: process.env.GITHUB_TOKEN,
    repo: parseRepoSlug(runOptions.repo),
    prNumber: runOptions.prNumber,
  };

  const state = reporter.getState();
  const overallStatus = computeOverallStatus(state);
  reporter.setRunMetadata(buildRunMetadata(overallStatus));

  try {
    const commentUrl = await syncPrComment(githubContext, reporter.getState(), {
      projectId: mixpanelProjectId,
      workspaceId: mixpanelWorkspaceId,
    });

    reporter.decision(
      "github-comment",
      "Updated",
      `Sticky PR comment synced (${overallStatus})`,
    );

    if (report) {
      try {
        const reviewCount = await syncReviewComments({
          context: githubContext,
          state: reporter.getState(),
          mixpanelProjectId,
          mixpanelWorkspaceId,
        });

        if (reviewCount > 0) {
          reporter.decision(
            "github-comment",
            "Inline review comments",
            `Posted ${reviewCount} file comment(s)`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Review comment sync failed";
        reporter.log("github-comment", message, "warn");
      }
    }

    reporter.phaseComplete("github-comment", "complete");

    return commentUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub comment sync failed";
    reporter.log("github-comment", message, "error");
    reporter.phaseComplete("github-comment", "failed");

    return undefined;
  }
};

export const runPipeline = async (options: IRunOptions): Promise<IFinalResult> => {
  const reporter = createProgressReporter();
  const config = loadInstrumentConfig(options.config);
  const changedFiles = resolveChangedFiles(options, options.config);
  const fileContents = loadFileContents(options.workspaceRoot, changedFiles);
  const mixpanelEnv = resolveMixpanelEnv(config);

  let report: IFinalResult["report"];
  let standardsReview: IFinalResult["standardsReview"];
  let dashboardPlan: IFinalResult["dashboardPlan"];
  let deployResult: IFinalResult["deployResult"];
  let commentUrl: string | undefined;
  let pipelineError: unknown;

  try {
    reporter.phaseStart("pre-scan");
    const assessment = runPreScan(changedFiles, fileContents, config, options.workspaceRoot);
    reporter.setAssessment(assessment);
    reporter.decision("pre-scan", "Assessment", assessment.summary);
    reporter.phaseComplete("pre-scan", "complete");

    const codeAgentResult = await runCodeAgent({
      prUrl: options.prUrl,
      workspaceRoot: options.workspaceRoot,
      assessment,
      dryRun: options.dryRun,
      skipCodeAgent: options.skipCodeAgent,
      reporter,
    });

    report = codeAgentResult?.report;

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

    if (dashboardPlan) {
      deployResult =
        (await runMixpanelDeploy({
          plan: dashboardPlan,
          envConfig: mixpanelEnv,
          dashboardName: config.mixpanel?.dashboardName,
          dryRun: options.dryRun,
          reportsOnly: options.reportsOnly,
          reporter,
        })) ?? undefined;
    }
  } catch (error) {
    pipelineError = error;
    reporter.log("pre-scan", "Pipeline failed before completion", "error");
  } finally {
    commentUrl = await syncGithubFeedback({
      runOptions: options,
      reporter,
      mixpanelProjectId: mixpanelEnv?.projectId,
      mixpanelWorkspaceId: mixpanelEnv?.workspaceId,
      report,
    });

    await reporter.finalize();
  }

  if (pipelineError) {
    throw pipelineError;
  }

  return {
    assessment: reporter.getState().assessment!,
    report,
    standardsReview,
    dashboardPlan,
    deployResult,
    commentUrl,
    dryRun: options.dryRun,
  };
};
