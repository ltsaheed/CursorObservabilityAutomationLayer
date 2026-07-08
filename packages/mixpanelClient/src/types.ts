export interface IMixpanelEnvConfig {
  serviceAccountUsername: string;
  serviceAccountSecret: string;
  projectId: string;
  workspaceId: string;
  dashboardId?: string;
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
}

export interface IMixpanelApiResponse<T> {
  status?: string;
  results?: T;
  error?: string;
}
