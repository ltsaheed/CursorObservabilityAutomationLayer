import { deployDashboardPlan } from "@instrument/mixpanel-client";
import type { IDeployDashboardPlanResult } from "@instrument/mixpanel-client";

import type { IDashboardPlan, IProgressReporter } from "./types.js";
import type { IMixpanelEnvConfig } from "./types.js";

export interface IMixpanelDeployOptions {
  plan: IDashboardPlan;
  envConfig: IMixpanelEnvConfig | null;
  dashboardName?: string;
  dryRun: boolean;
  reportsOnly: boolean;
  reporter: IProgressReporter;
}

export const runMixpanelDeploy = async (
  options: IMixpanelDeployOptions,
): Promise<IDeployDashboardPlanResult | null> => {
  const { plan, envConfig, dryRun, reportsOnly, reporter, dashboardName } = options;

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

  if (dryRun) {
    reporter.decision("mixpanel-deploy", "Dry run", "Simulating Mixpanel deployment");
  }

  const result = await deployDashboardPlan({
    config: {
      serviceAccountUsername: envConfig.serviceAccountUsername,
      serviceAccountSecret: envConfig.serviceAccountSecret,
      projectId: envConfig.projectId,
      workspaceId: envConfig.workspaceId,
      dashboardId: envConfig.dashboardId,
      region: envConfig.region,
    },
    plan,
    dashboardName: dashboardName ?? "Instrument Reports",
    dryRun,
  });

  reporter.setDeployResult(result);
  reporter.decision(
    "mixpanel-deploy",
    "Deployed",
    `${result.reports.length} report(s) on dashboard ${result.dashboardId}`,
  );
  reporter.phaseComplete("mixpanel-deploy", "complete");

  return result;
};
