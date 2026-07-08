import { buildBookmarkParams } from "./bookmarkParams.js";
import {
  MixpanelAppApiError,
  createMixpanelHttpClient,
  getCreateBookmarkPath,
  getCreateDashboardPath,
  getDashboardPath,
} from "./client.js";
import { resolveMixpanelRegion } from "./endpoints.js";
import type {
  ICreateBookmarkParams,
  ICreateDashboardParams,
  ICreateInlineReportParams,
  IDeployDashboardPlanOptions,
  IDeployDashboardPlanResult,
  IDeployedReport,
  IMixpanelBookmark,
  IMixpanelClientConfig,
  IMixpanelDashboard,
  IMixpanelDashboardDetail,
} from "./types.js";
import { buildDashboardUrl, buildMixpanelReportUrl } from "./urls.js";

const DEFAULT_DASHBOARD_NAME = "Instrument Reports";

const isSavedReportsLimitError = (error: unknown): boolean =>
  error instanceof MixpanelAppApiError &&
  error.message.toLowerCase().includes("limit of saved reports");

export {
  buildBookmarkParams,
  buildFunnelsBookmarkParams,
  buildInsightsBookmarkParams,
} from "./bookmarkParams.js";

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

export const getDashboard = async (
  config: IMixpanelClientConfig,
  dashboardId: number,
): Promise<IMixpanelDashboardDetail> => {
  const client = createMixpanelHttpClient(config);
  const path = getDashboardPath(config, dashboardId);

  return client.get<IMixpanelDashboardDetail>(path);
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
    v: 2,
  };

  if (params.description) {
    body.description = params.description;
  }

  const bookmark = await client.post<IMixpanelBookmark>(path, body);

  return bookmark;
};

export const addReportToDashboard = async (
  config: IMixpanelClientConfig,
  dashboardId: number,
  bookmarkId: number,
): Promise<IMixpanelDashboardDetail> => {
  const client = createMixpanelHttpClient(config);
  const path = getDashboardPath(config, dashboardId);

  return client.patch<IMixpanelDashboardDetail>(path, {
    content: {
      action: "create",
      content_type: "report",
      content_params: {
        source_bookmark_id: bookmarkId,
      },
    },
  });
};

export const createInlineReportOnDashboard = async (
  config: IMixpanelClientConfig,
  dashboardId: number,
  params: ICreateInlineReportParams,
): Promise<IMixpanelDashboardDetail> => {
  const client = createMixpanelHttpClient(config);
  const path = getDashboardPath(config, dashboardId);
  const bookmarkPayload: Record<string, unknown> = {
    name: params.name,
    type: params.bookmarkType,
    params: JSON.stringify(params.params),
  };

  if (params.description) {
    bookmarkPayload.description = params.description;
  }

  return client.patch<IMixpanelDashboardDetail>(path, {
    content: {
      action: "create",
      content_type: "report",
      content_params: {
        bookmark: bookmarkPayload,
      },
    },
  });
};

export const findReportOnDashboard = (
  dashboard: IMixpanelDashboardDetail,
  reportName: string,
): { contentId: number; bookmarkId: number } | undefined => {
  const reports = dashboard.contents?.report;

  if (!reports) {
    return undefined;
  }

  for (const [contentId, report] of Object.entries(reports)) {
    if (report.name === reportName) {
      return { contentId: Number(contentId), bookmarkId: report.id };
    }
  }

  return undefined;
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
  let truncatedByLimit = false;

  let currentDashboard: IMixpanelDashboardDetail | undefined;

  try {
    currentDashboard = await getDashboard(config, dashboardId);
  } catch {
    currentDashboard = undefined;
  }

  for (const reportPlan of plan.reports) {
    const existing = currentDashboard
      ? findReportOnDashboard(currentDashboard, reportPlan.name)
      : undefined;

    if (existing) {
      reports.push({
        plan: reportPlan,
        bookmarkId: existing.bookmarkId,
        reportUrl: buildMixpanelReportUrl(
          config.projectId,
          config.workspaceId,
          dashboardId,
          existing.bookmarkId,
          region,
        ),
      });

      continue;
    }

    try {
      const bookmark = await createBookmark(config, {
        name: reportPlan.name,
        bookmarkType: reportPlan.type,
        description: reportPlan.description,
        dashboardId,
        params: buildBookmarkParams(reportPlan),
      });

      const dashboard = await addReportToDashboard(config, dashboardId, bookmark.id);

      currentDashboard = dashboard;

      const located = findReportOnDashboard(dashboard, reportPlan.name);
      const bookmarkId = located?.bookmarkId ?? bookmark.id;

      reports.push({
        plan: reportPlan,
        bookmarkId,
        reportUrl: buildMixpanelReportUrl(
          config.projectId,
          config.workspaceId,
          dashboardId,
          bookmarkId,
          region,
        ),
      });
    } catch (error) {
      if (isSavedReportsLimitError(error)) {
        truncatedByLimit = true;
        break;
      }

      throw error;
    }
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
    truncatedByLimit,
  };
};
