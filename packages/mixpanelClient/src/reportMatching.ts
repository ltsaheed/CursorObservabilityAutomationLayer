import type {
  IMixpanelDashboardDetail,
  IMixpanelDashboardReportContent,
  IReportPlan,
} from "./types.js";

export const DUPLICATE_REPORT_PREFIX = /^Duplicate of /i;

export const normalizeReportName = (name: string): string => {
  return name.replace(DUPLICATE_REPORT_PREFIX, "").trim();
};

export const parseReportParams = (
  params?: string | Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!params) {
    return undefined;
  }

  if (typeof params === "object") {
    return params;
  }

  try {
    return JSON.parse(params) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export const getInsightsEventFromParams = (
  params?: string | Record<string, unknown>,
): string | undefined => {
  const parsed = parseReportParams(params);
  const sections = parsed?.sections as
    | {
        show?: Array<{
          behavior?: {
            value?: {
              name?: string;
            };
          };
        }>;
      }
    | undefined;

  return sections?.show?.[0]?.behavior?.value?.name;
};

export const getFunnelStepsFromParams = (
  params?: string | Record<string, unknown>,
): string[] => {
  const parsed = parseReportParams(params);
  const sections = parsed?.sections as
    | {
        show?: Array<{
          behavior?: {
            behaviors?: Array<{
              name?: string;
            }>;
          };
        }>;
      }
    | undefined;

  return (
    sections?.show?.[0]?.behavior?.behaviors
      ?.map((behavior) => behavior.name)
      .filter((step): step is string => Boolean(step)) ?? []
  );
};

const namesMatchPlan = (report: IMixpanelDashboardReportContent, reportPlan: IReportPlan): boolean => {
  return (
    report.name === reportPlan.name ||
    normalizeReportName(report.name) === reportPlan.name
  );
};

const eventsMatchPlan = (
  report: IMixpanelDashboardReportContent,
  reportPlan: IReportPlan,
): boolean => {
  if (reportPlan.type === "insights" && report.type === "insights") {
    return getInsightsEventFromParams(report.params) === reportPlan.event;
  }

  if (reportPlan.type === "funnels" && report.type === "funnels") {
    const steps = getFunnelStepsFromParams(report.params);

    return (
      steps.length === reportPlan.steps.length &&
      steps.every((step, index) => step === reportPlan.steps[index])
    );
  }

  return false;
};

export const findReportForPlanOnDashboard = (
  dashboard: IMixpanelDashboardDetail,
  reportPlan: IReportPlan,
): { contentId: number; bookmarkId: number } | undefined => {
  const reports = dashboard.contents?.report;

  if (!reports) {
    return undefined;
  }

  for (const [contentId, report] of Object.entries(reports)) {
    if (namesMatchPlan(report, reportPlan) || eventsMatchPlan(report, reportPlan)) {
      return { contentId: Number(contentId), bookmarkId: report.id };
    }
  }

  return undefined;
};

/** @deprecated Use findReportForPlanOnDashboard for plan-aware matching. */
export const findReportOnDashboard = (
  dashboard: IMixpanelDashboardDetail,
  reportName: string,
): { contentId: number; bookmarkId: number } | undefined => {
  const reports = dashboard.contents?.report;

  if (!reports) {
    return undefined;
  }

  for (const [contentId, report] of Object.entries(reports)) {
    if (report.name === reportName || normalizeReportName(report.name) === reportName) {
      return { contentId: Number(contentId), bookmarkId: report.id };
    }
  }

  return undefined;
};
