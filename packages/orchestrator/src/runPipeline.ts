import {
  createPhaseContext,
  runCodeAgentPhase,
  runPreScanPhase,
  runReviewPhase,
} from "./runPhases.js";
import {
  runCommentPhase,
  runDashboardPhase,
  runDeployPhase,
} from "./runPhasesPost.js";
import type { IFinalResult, IRunOptions } from "./types.js";

export const runPipeline = async (options: IRunOptions): Promise<IFinalResult> => {
  const ctx = createPhaseContext(options);
  let report: IFinalResult["report"];
  let standardsReview: IFinalResult["standardsReview"];
  let dashboardPlan: IFinalResult["dashboardPlan"];
  let deployResult: IFinalResult["deployResult"];
  let commentUrl: string | undefined;
  let pipelineError: unknown;

  try {
    await runPreScanPhase(ctx);
    report = await runCodeAgentPhase(ctx);

    if (report) {
      const reviewResult = await runReviewPhase(ctx);
      standardsReview = reviewResult.standardsReview;

      if (reviewResult.report) {
        report = reviewResult.report;
      } else if (standardsReview?.passed === false) {
        report = undefined;
      }
    }

    if (report) {
      dashboardPlan = await runDashboardPhase(ctx);
    }

    if (dashboardPlan) {
      deployResult = await runDeployPhase(ctx);
    }
  } catch (error) {
    pipelineError = error;
    ctx.reporter.log("pre-scan", "Pipeline failed before completion", "error");
  } finally {
    commentUrl = await runCommentPhase(ctx, report);
    await ctx.reporter.finalize();
  }

  if (pipelineError) {
    throw pipelineError;
  }

  return {
    assessment: ctx.reporter.getState().assessment!,
    report,
    standardsReview,
    dashboardPlan,
    deployResult,
    commentUrl,
    dryRun: options.dryRun,
  };
};
