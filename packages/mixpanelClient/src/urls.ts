const MIXPANEL_APP_ORIGIN = "https://mixpanel.com";

export const buildMixpanelReportUrl = (
  projectId: string,
  workspaceId: string,
  dashboardId: number | string,
  bookmarkId: number | string,
): string => {
  const hash = `#id=${dashboardId}&editor-card-id="report-${bookmarkId}"`;

  return `${MIXPANEL_APP_ORIGIN}/project/${projectId}/view/${workspaceId}/app/boards${hash}`;
};

export const buildDashboardUrl = (
  projectId: string,
  workspaceId: string,
  dashboardId: number | string,
): string => {
  return `${MIXPANEL_APP_ORIGIN}/project/${projectId}/view/${workspaceId}/app/boards#id=${dashboardId}`;
};

export const buildMixpanelEventsUrl = (
  projectId: string,
  workspaceId: string,
  eventName: string,
): string => {
  const encoded = encodeURIComponent(eventName);

  return `${MIXPANEL_APP_ORIGIN}/project/${projectId}/view/${workspaceId}/app/events#${encoded}`;
};
