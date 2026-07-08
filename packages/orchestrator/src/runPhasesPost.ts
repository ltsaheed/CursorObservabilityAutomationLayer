import { runDashboardAgent } from "./dashboardAgent.js";
import { computeOverallStatus, parseRepoSlug, syncPrComment } from "./github.js";
import { runMixpanelDeploy } from "./mixpanelDeploy.js";
import { loadPipelineState } from "./pipelineState.js";
import { syncReviewComments } from "./reviewComments.js";
import type { IFinalResult } from "./types.js";
import {
  buildRunMetadata,
  savePhaseContext,
  type IPhaseContext,
} from "./runPhases.js";

export const runDashboardPhase = async (
  ctx: IPhaseContext,
): Promise<IFinalResult["dashboardPlan"]> => {
  const report = ctx.reporter.getState().report ?? loadPipelineState(ctx.options.workspaceRoot).report;

  if (!report) {
    ctx.reporter.phaseStart("dashboard-agent");
    ctx.reporter.decision(
      "dashboard-agent",
      "Skipped",
      "No instrumentation report available",
    );
    ctx.reporter.phaseComplete("dashboard-agent", "skipped");
    savePhaseContext(ctx);

    return undefined;
  }

  const dashboardPlan = await runDashboardAgent(report, {
    dryRun: ctx.options.dryRun,
    reporter: ctx.reporter,
  });
  savePhaseContext(ctx, { dashboardPlan });

  return dashboardPlan;
};

export const runDeployPhase = async (
  ctx: IPhaseContext,
): Promise<IFinalResult["deployResult"]> => {
  const dashboardPlan =
    ctx.reporter.getState().dashboardPlan ?? loadPipelineState(ctx.options.workspaceRoot).dashboardPlan;

  if (!dashboardPlan) {
    return undefined;
  }

  const deployResult =
    (await runMixpanelDeploy({
      plan: dashboardPlan,
      envConfig: ctx.mixpanelEnv,
      dashboardName: ctx.config.mixpanel?.dashboardName,
      dryRun: ctx.options.dryRun,
      reportsOnly: ctx.options.reportsOnly,
      reporter: ctx.reporter,
    })) ?? undefined;
  savePhaseContext(ctx, { deployResult });

  return deployResult;
};

export const runCommentPhase = async (
  ctx: IPhaseContext,
  report?: IFinalResult["report"],
): Promise<string | undefined> => {
  const { options, reporter, mixpanelEnv } = ctx;

  if (!options.repo || !options.prNumber || !process.env.GITHUB_TOKEN) {
    reporter.phaseStart("github-comment");
    reporter.decision(
      "github-comment",
      "Skipped",
      "Missing repo/prNumber/GITHUB_TOKEN",
    );
    reporter.phaseComplete("github-comment", "skipped");
    savePhaseContext(ctx);

    return undefined;
  }

  reporter.phaseStart("github-comment");

  const githubContext = {
    token: process.env.GITHUB_TOKEN,
    repo: parseRepoSlug(options.repo),
    prNumber: options.prNumber,
  };
  const overallStatus = computeOverallStatus(reporter.getState());
  reporter.setRunMetadata(buildRunMetadata(overallStatus));

  try {
    const commentUrl = await syncPrComment(githubContext, reporter.getState(), {
      projectId: mixpanelEnv?.projectId,
      workspaceId: mixpanelEnv?.workspaceId,
      region: mixpanelEnv?.region,
    });

    reporter.decision(
      "github-comment",
      "Updated",
      `Sticky PR comment synced (${overallStatus})`,
    );

    if (report) {
      try {
        const { posted, skipped } = await syncReviewComments({
          context: githubContext,
          state: reporter.getState(),
          mixpanelProjectId: mixpanelEnv?.projectId,
          mixpanelWorkspaceId: mixpanelEnv?.workspaceId,
          mixpanelRegion: mixpanelEnv?.region,
        });

        if (posted > 0) {
          reporter.decision(
            "github-comment",
            "Inline review comments",
            `Posted ${posted} file comment(s)`,
          );
        }

        if (skipped > 0) {
          reporter.log(
            "github-comment",
            `Skipped ${skipped} inline comment(s) that could not be anchored to the PR diff`,
            "warn",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Review comment sync failed";
        reporter.log("github-comment", message, "warn");
      }
    }

    reporter.phaseComplete("github-comment", "complete");
    savePhaseContext(ctx);

    return commentUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub comment sync failed";
    reporter.log("github-comment", message, "error");
    reporter.phaseComplete("github-comment", "failed");
    savePhaseContext(ctx);

    return undefined;
  }
};
