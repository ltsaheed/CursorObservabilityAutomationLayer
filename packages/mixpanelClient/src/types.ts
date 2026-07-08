import type { IMixpanelRegion } from "./endpoints.js";

export interface IMixpanelEnvConfig {
  serviceAccountUsername: string;
  serviceAccountSecret: string;
  projectId: string;
  workspaceId: string;
  dashboardId?: string;
  region?: IMixpanelRegion;
}

export interface IMixpanelApiPathConfig {
  /**
   * Relative path under /api/app/ for dashboard creation.
   * Placeholders: {workspaceId}, {projectId}
   * Default: workspaces/{workspaceId}/dashboards
   */
  createDashboardPath?: string;

  /**
   * Relative path under /api/app/ for bookmark creation.
   * Placeholders: {workspaceId}, {projectId}
   * Default: workspaces/{workspaceId}/bookmarks
   */
  createBookmarkPath?: string;
}

export interface IMixpanelClientConfig extends IMixpanelEnvConfig {
  baseUrl?: string;
  apiPaths?: IMixpanelApiPathConfig;
  fetchImpl?: typeof fetch;
}

export interface IMixpanelDashboard {
  id: number;
  title: string;
  description?: string;
}

export interface IMixpanelDashboardReportContent {
  id: number;
  name: string;
  type: "insights" | "funnels";
  description?: string;
  params?: string | Record<string, unknown>;
}

export interface IMixpanelDashboardDetail extends IMixpanelDashboard {
  layout?: {
    order: string[];
    rows: Record<
      string,
      {
        height: number;
        cells: Array<{
          id: string;
          width: number;
          content_id: number;
          content_type: string;
        }>;
      }
    >;
  };
  contents?: {
    report?: Record<string, IMixpanelDashboardReportContent>;
  };
}

export interface ICreateInlineReportParams {
  name: string;
  bookmarkType: "insights" | "funnels";
  params: Record<string, unknown>;
  description?: string;
}

export interface IMixpanelBookmark {
  id: number;
  name: string;
  type: "insights" | "funnels";
  description?: string;
}

export interface ICreateDashboardParams {
  title: string;
  description?: string;
}

export interface ICreateBookmarkParams {
  name: string;
  bookmarkType: "insights" | "funnels";
  params: Record<string, unknown>;
  dashboardId: number;
  description?: string;
}

export interface IDashboardPlanDecision {
  summary: string;
  reason: string;
}

export interface IInsightsReportPlan {
  type: "insights";
  name: string;
  description: string;
  event: string;
  breakdown?: string;
  reason: string;
}

export interface IFunnelsReportPlan {
  type: "funnels";
  name: string;
  description: string;
  steps: string[];
  reason: string;
}

export type IReportPlan = IInsightsReportPlan | IFunnelsReportPlan;

export interface IDashboardPlan {
  decisions: IDashboardPlanDecision[];
  reports: IReportPlan[];
}

export interface IDeployedReport {
  plan: IReportPlan;
  bookmarkId: number;
  reportUrl: string;
}

export interface IDeployDashboardPlanOptions {
  config: IMixpanelClientConfig;
  plan: IDashboardPlan;
  dashboardName?: string;
  dryRun?: boolean;
}

export interface IDeployDashboardPlanResult {
  dashboardId: number;
  dashboardUrl: string;
  reports: IDeployedReport[];
  createdDashboard: boolean;
  /**
   * True when at least one planned report was skipped because the Mixpanel
   * project hit its saved-reports limit. The reports that were created before
   * the limit was reached are still returned.
   */
  truncatedByLimit?: boolean;
}

export interface IMixpanelApiResponse<T> {
  status?: string;
  results?: T;
  error?: string;
}
