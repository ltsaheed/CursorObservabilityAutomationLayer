import {
  createMixpanelHttpClient,
  getCreateBookmarkPath,
  getCreateDashboardPath,
} from "./client.js";
import type {
  ICreateBookmarkParams,
  ICreateDashboardParams,
  IDeployDashboardPlanOptions,
  IDeployDashboardPlanResult,
  IDeployedReport,
  IFunnelsReportPlan,
  IInsightsReportPlan,
  IMixpanelBookmark,
  IMixpanelClientConfig,
  IMixpanelDashboard,
  IReportPlan,
} from "./types.js";
import { resolveMixpanelRegion } from "./endpoints.js";
import { buildDashboardUrl, buildMixpanelReportUrl } from "./urls.js";

const DEFAULT_DASHBOARD_NAME = "Instrument Reports";

export const buildInsightsBookmarkParams = (
  plan: IInsightsReportPlan,
): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    sections: {
      show: [],
      hide: [],
    },
    displayOptions: {
      chartType: "line",
    },
    time: {
      dateRangeType: "inclusive",
      window: {
        unit: "day",
        value: 30,
      },
    },
    analysis: {
      type: "linear",
    },
    series: [
      {
        event: plan.event,
        name: plan.event,
        type: "event",
      },
    ],
  };

  if (plan.breakdown) {
    params.breakdowns = [
      {
        property: plan.breakdown,
        resourceType: "event",
      },
    ];
  }

  return params;
};

export const buildFunnelsBookmarkParams = (
  plan: IFunnelsReportPlan,
): Record<string, unknown> => {
  return {
    events: plan.steps.map((event, index) => ({
      event,
      name: event,
      step: index + 1,
    })),
    time: {
      dateRangeType: "inclusive",
      window: {
        unit: "day",
        value: 30,
      },
    },
  };
};

export const buildBookmarkParams = (
  plan: IReportPlan,
): Record<string, unknown> => {
  if (plan.type === "insights") {
    return buildInsightsBookmarkParams(plan);
  }

  return buildFunnelsBookmarkParams(plan);
};

export const createDashboard = async (
  config: IMixpanelClientConfig,
  params: ICreateDashboardParams,
): Promise<IMixpanelDashboard> => {
  const client = createMixpanelHttpClient(config);
  const path = getCreateDashboardPath(config);
  const body: Record<string, unknown> = {
    title: params.title,
  };

  if (params.description) {
    body.description = params.description;
  }

  const dashboard = await client.post<IMixpanelDashboard>(path, body);

  return dashboard;
};

export const createBookmark = async (
  config: IMixpanelClientConfig,
  params: ICreateBookmarkParams,
): Promise<IMixpanelBookmark> => {
  const client = createMixpanelHttpClient(config);
  const path = getCreateBookmarkPath(config);
  const body: Record<string, unknown> = {
    name: params.name,
    type: params.bookmarkType,
    params: params.params,
    dashboard_id: params.dashboardId,
  };

  if (params.description) {
    body.description = params.description;
  }

  const bookmark = await client.post<IMixpanelBookmark>(path, body);

  return bookmark;
};

export const deployDashboardPlan = async (
  options: IDeployDashboardPlanOptions,
): Promise<IDeployDashboardPlanResult> => {
  const {
    config,
    plan,
    dashboardName = DEFAULT_DASHBOARD_NAME,
    dryRun = false,
  } = options;
  const region = resolveMixpanelRegion(config.region);
  let dashboardId = config.dashboardId ? Number(config.dashboardId) : undefined;
  let createdDashboard = false;

  if (dryRun) {
    dashboardId = dashboardId ?? 0;

    return {
      dashboardId,
      dashboardUrl: buildDashboardUrl(
        config.projectId,
        config.workspaceId,
        dashboardId,
        region,
      ),
      reports: plan.reports.map((reportPlan, index) => ({
        plan: reportPlan,
        bookmarkId: index + 1,
        reportUrl: buildMixpanelReportUrl(
          config.projectId,
          config.workspaceId,
          dashboardId!,
          index + 1,
          region,
        ),
      })),
      createdDashboard: !config.dashboardId,
    };
  }

  if (!dashboardId) {
    const dashboard = await createDashboard(config, {
      title: dashboardName,
      description: "Reports created automatically by Instrument",
    });
    dashboardId = dashboard.id;
    createdDashboard = true;
  }

  const reports: IDeployedReport[] = [];

  for (const reportPlan of plan.reports) {
    const bookmark = await createBookmark(config, {
      name: reportPlan.name,
      bookmarkType: reportPlan.type,
      description: reportPlan.description,
      dashboardId,
      params: buildBookmarkParams(reportPlan),
    });

    reports.push({
      plan: reportPlan,
      bookmarkId: bookmark.id,
      reportUrl: buildMixpanelReportUrl(
        config.projectId,
        config.workspaceId,
        dashboardId,
        bookmark.id,
        region,
      ),
    });
  }

  return {
    dashboardId,
    dashboardUrl: buildDashboardUrl(
      config.projectId,
      config.workspaceId,
      dashboardId,
      region,
    ),
    reports,
    createdDashboard,
  };
};
