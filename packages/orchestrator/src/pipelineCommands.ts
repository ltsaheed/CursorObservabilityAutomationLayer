import { runPipeline } from "./runPipeline.js";
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

export type IPipelinePhaseName =
  | "pre-scan"
  | "code-agent"
  | "review"
  | "dashboard"
  | "deploy"
  | "comment";

export const runPipelinePhase = async (
  phase: IPipelinePhaseName,
  options: IRunOptions,
): Promise<Partial<IFinalResult>> => {
  const ctx = createPhaseContext(options);

  switch (phase) {
    case "pre-scan":
      await runPreScanPhase(ctx);

      return { assessment: ctx.reporter.getState().assessment! };
    case "code-agent": {
      const report = await runCodeAgentPhase(ctx);

      return { report };
    }
    case "review":
      return runReviewPhase(ctx);
    case "dashboard": {
      const dashboardPlan = await runDashboardPhase(ctx);

      return { dashboardPlan };
    }
    case "deploy": {
      const deployResult = await runDeployPhase(ctx);

      return { deployResult };
    }
    case "comment": {
      const report = ctx.reporter.getState().report;
      const commentUrl = await runCommentPhase(ctx, report);
      await ctx.reporter.finalize();

      return { commentUrl };
    }
    default:
      throw new Error(`Unknown pipeline phase: ${String(phase)}`);
  }
};

export const runFullPipeline = async (options: IRunOptions): Promise<IFinalResult> =>
  runPipeline(options);
