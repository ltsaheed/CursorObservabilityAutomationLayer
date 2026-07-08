import {
  buildDashboardUrl,
  deployDashboardPlan,
  MixpanelAppApiError,
} from "@instrument/mixpanel-client";
import type { IDeployDashboardPlanResult } from "@instrument/mixpanel-client";

import { loadPipelineState } from "./pipelineState.js";
import type { IDashboardPlan, IProgressReporter } from "./types.js";
import type { IMixpanelEnvConfig } from "./types.js";

export interface IMixpanelDeployOptions {
  plan: IDashboardPlan;
  envConfig: IMixpanelEnvConfig | null;
  workspaceRoot: string;
  dashboardName?: string;
  dryRun: boolean;
  reportsOnly: boolean;
  reporter: IProgressReporter;
}

const resolveDashboardIdForDeploy = (
  workspaceRoot: string,
  envDashboardId?: string,
): string | undefined => {
  if (envDashboardId) {
    return envDashboardId;
  }

  const previousDashboardId = loadPipelineState(workspaceRoot).deployResult?.dashboardId;

  return previousDashboardId !== undefined ? String(previousDashboardId) : undefined;
};

const isSavedReportsLimitError = (error: unknown): boolean => {
  if (!(error instanceof MixpanelAppApiError)) {
    return false;
  }

  return error.message.toLowerCase().includes("limit of saved reports");
};

const formatMixpanelBoardsLocation = (envConfig: IMixpanelEnvConfig): string => {
  const dashboardId = envConfig.dashboardId ?? "(auto-created on first deploy)";
  const url = envConfig.dashboardId
    ? buildDashboardUrl(
        envConfig.projectId,
        envConfig.workspaceId,
        envConfig.dashboardId,
        envConfig.region,
      )
    : buildDashboardUrl(envConfig.projectId, envConfig.workspaceId, 0, envConfig.region).replace(
        "#id=0",
        "#boards",
      );

  return `Mixpanel Boards dashboard id ${dashboardId} · ${url}`;
};

export const runMixpanelDeploy = async (
  options: IMixpanelDeployOptions,
): Promise<IDeployDashboardPlanResult | null> => {
  const { plan, envConfig, dryRun, reportsOnly, reporter, dashboardName, workspaceRoot } =
    options;

  reporter.phaseStart("mixpanel-deploy");

  if (reportsOnly) {
    reporter.decision("mixpanel-deploy", "Skipped", "reportsOnly flag enabled");
    reporter.phaseComplete("mixpanel-deploy", "skipped");

    return null;
  }

  if (!envConfig) {
    reporter.decision(
      "mixpanel-deploy",
      "Skipped",
      "Mixpanel env vars are not fully configured",
    );
    reporter.phaseComplete("mixpanel-deploy", "skipped");

    return null;
  }

  if (plan.reports.length === 0) {
    reporter.decision(
      "mixpanel-deploy",
      "Skipped",
      "No new events to deploy; dashboard plan has zero reports",
    );
    reporter.phaseComplete("mixpanel-deploy", "skipped");

    return null;
  }

  const dashboardId = resolveDashboardIdForDeploy(workspaceRoot, envConfig.dashboardId);
  const deployConfig = {
    ...envConfig,
    dashboardId,
  };

  reporter.decision(
    "mixpanel-deploy",
    "Target",
    formatMixpanelBoardsLocation({ ...deployConfig, dashboardId }),
  );

  if (dryRun) {
    reporter.decision("mixpanel-deploy", "Dry run", "Simulating Mixpanel deployment");
  }

  try {
    const result = await deployDashboardPlan({
      config: {
        serviceAccountUsername: deployConfig.serviceAccountUsername,
        serviceAccountSecret: deployConfig.serviceAccountSecret,
        projectId: deployConfig.projectId,
        workspaceId: deployConfig.workspaceId,
        dashboardId: deployConfig.dashboardId,
        region: deployConfig.region,
      },
      plan,
      dashboardName: dashboardName ?? "Instrument Reports",
      dryRun,
    });

    reporter.setDeployResult(result);

    if (result.truncatedByLimit) {
      const planned = plan.reports.length;
      const created = result.reports.length;

      reporter.log(
        "mixpanel-deploy",
        `Mixpanel saved-reports limit reached: created ${created} of ${planned} planned report(s). Delete unused saved reports in Mixpanel, set MIXPANEL_DASHBOARD_ID to reuse one board, or upgrade the project plan.`,
        "warn",
      );
      reporter.decision(
        "mixpanel-deploy",
        "Partial",
        `${created}/${planned} report(s) on dashboard ${result.dashboardId} · ${result.dashboardUrl}`,
      );
    } else {
      reporter.decision(
        "mixpanel-deploy",
        "Deployed",
        `${result.reports.length} report(s) on dashboard ${result.dashboardId} · ${result.dashboardUrl}`,
      );
    }

    reporter.phaseComplete("mixpanel-deploy", "complete");

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mixpanel deploy failed";

    if (isSavedReportsLimitError(error)) {
      reporter.log(
        "mixpanel-deploy",
        `${message}. Delete unused saved reports in Mixpanel (Boards or Reports), set MIXPANEL_DASHBOARD_ID to reuse one board, or upgrade the project plan.`,
        "warn",
      );
      reporter.decision(
        "mixpanel-deploy",
        "Failed",
        "Mixpanel saved-reports limit reached; PR comment phase will still run",
      );
      reporter.phaseComplete("mixpanel-deploy", "failed");

      return null;
    }

    reporter.log("mixpanel-deploy", message, "error");
    reporter.decision("mixpanel-deploy", "Failed", message);
    reporter.phaseComplete("mixpanel-deploy", "failed");

    throw error;
  }
};
