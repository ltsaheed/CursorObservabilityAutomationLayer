import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runCodeAgent, buildGithubContextFromRunOptions } from "./codeAgent.js";
import { loadInstrumentConfig, resolveMixpanelEnv } from "./config.js";
import { loadPipelineState, persistReporterState, saveRunOptionsSnapshot } from "./pipelineState.js";
import { runPreScan } from "./preScan.js";
import { createProgressReporter } from "./progressReporter.js";
import { runStandardsReviewLoop, StandardsReviewError } from "./standardsReviewLoop.js";
import type {
  IFinalResult,
  IProgressReporter,
  IRunMetadata,
  IRunOptions,
} from "./types.js";

export interface IPhaseContext {
  options: IRunOptions;
  reporter: IProgressReporter;
  config: ReturnType<typeof loadInstrumentConfig>;
  changedFiles: string[];
  mixpanelEnv: ReturnType<typeof resolveMixpanelEnv>;
}

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

export const buildRunMetadata = (
  overallStatus: IRunMetadata["overallStatus"],
): IRunMetadata => {
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

export const createPhaseContext = (options: IRunOptions): IPhaseContext => {
  const saved = loadPipelineState(options.workspaceRoot);
  const config = loadInstrumentConfig(options.config);
  saveRunOptionsSnapshot(options.workspaceRoot, options);

  return {
    options,
    reporter: createProgressReporter(saved.progress),
    config,
    changedFiles: resolveChangedFiles(options, options.config),
    mixpanelEnv: resolveMixpanelEnv(config),
  };
};

export const savePhaseContext = (
  ctx: IPhaseContext,
  patch: Parameters<typeof persistReporterState>[2] = {},
): void => {
  const state = ctx.reporter.getState();

  persistReporterState(ctx.options.workspaceRoot, ctx.reporter, {
    assessment: state.assessment,
    report: state.report,
    codeAgentId: state.codeAgentId,
    standardsReview: state.standardsReview,
    dashboardPlan: state.dashboardPlan,
    deployResult: state.deployResult,
    ...patch,
  });
};

export const runPreScanPhase = async (ctx: IPhaseContext): Promise<void> => {
  const fileContents = loadFileContents(ctx.options.workspaceRoot, ctx.changedFiles);

  ctx.reporter.phaseStart("pre-scan");
  const assessment = runPreScan(
    ctx.changedFiles,
    fileContents,
    ctx.config,
    ctx.options.workspaceRoot,
  );
  ctx.reporter.setAssessment(assessment);
  ctx.reporter.decision("pre-scan", "Assessment", assessment.summary);
  ctx.reporter.phaseComplete("pre-scan", "complete");
  savePhaseContext(ctx);
};

export const runCodeAgentPhase = async (
  ctx: IPhaseContext,
): Promise<IFinalResult["report"]> => {
  const assessment = ctx.reporter.getState().assessment ?? loadPipelineState(ctx.options.workspaceRoot).assessment;

  if (!assessment) {
    throw new Error("Pre-scan assessment is required before code-agent phase");
  }

  const codeAgentResult = await runCodeAgent({
    prUrl: ctx.options.prUrl,
    workspaceRoot: ctx.options.workspaceRoot,
    assessment,
    dryRun: ctx.options.dryRun,
    skipCodeAgent: ctx.options.skipCodeAgent,
    reporter: ctx.reporter,
    github: buildGithubContextFromRunOptions(ctx.options),
  });

  if (codeAgentResult?.agentId) {
    ctx.reporter.setCodeAgentId(codeAgentResult.agentId);
  }

  savePhaseContext(ctx, {
    report: codeAgentResult?.report,
    codeAgentId: codeAgentResult?.agentId,
  });

  return codeAgentResult?.report;
};

export const runReviewPhase = async (
  ctx: IPhaseContext,
): Promise<{ report?: IFinalResult["report"]; standardsReview?: IFinalResult["standardsReview"] }> => {
  const saved = loadPipelineState(ctx.options.workspaceRoot);
  const assessment = ctx.reporter.getState().assessment ?? saved.assessment;
  const report = ctx.reporter.getState().report ?? saved.report;
  const codeAgentId = ctx.reporter.getState().codeAgentId ?? saved.codeAgentId;

  if (!assessment || !report) {
    return {};
  }

  try {
    const reviewLoopResult = await runStandardsReviewLoop({
      workspaceRoot: ctx.options.workspaceRoot,
      assessment,
      report,
      codeAgentId,
      dryRun: ctx.options.dryRun,
      reporter: ctx.reporter,
      github: buildGithubContextFromRunOptions(ctx.options),
    });
    ctx.reporter.setStandardsReview(reviewLoopResult.review);
    savePhaseContext(ctx, {
      report: reviewLoopResult.report,
      standardsReview: reviewLoopResult.review,
    });

    return {
      report: reviewLoopResult.report,
      standardsReview: reviewLoopResult.review,
    };
  } catch (error) {
    if (error instanceof StandardsReviewError) {
      ctx.reporter.setStandardsReview({
        passed: false,
        issues: error.issues,
        summary: error.message,
        decisions: [],
      });
      savePhaseContext(ctx, { standardsReview: ctx.reporter.getState().standardsReview });

      return { standardsReview: ctx.reporter.getState().standardsReview };
    }

    throw error;
  }
};
