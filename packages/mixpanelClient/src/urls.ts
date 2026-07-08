import {
  DEFAULT_MIXPANEL_REGION,
  getMixpanelEndpoints,
  type IMixpanelRegion,
} from "./endpoints.js";

export const buildMixpanelReportUrl = (
  projectId: string,
  workspaceId: string,
  dashboardId: number | string,
  bookmarkId: number | string,
  region: IMixpanelRegion = DEFAULT_MIXPANEL_REGION,
): string => {
  const appOrigin = getMixpanelEndpoints(region).appOrigin;
  const hash = `#id=${dashboardId}&editor-card-id="report-${bookmarkId}"`;

  return `${appOrigin}/project/${projectId}/view/${workspaceId}/app/boards${hash}`;
};

export const buildDashboardUrl = (
  projectId: string,
  workspaceId: string,
  dashboardId: number | string,
  region: IMixpanelRegion = DEFAULT_MIXPANEL_REGION,
): string => {
  const appOrigin = getMixpanelEndpoints(region).appOrigin;

  return `${appOrigin}/project/${projectId}/view/${workspaceId}/app/boards#id=${dashboardId}`;
};

export const buildMixpanelEventsUrl = (
  projectId: string,
  workspaceId: string,
  eventName: string,
  region: IMixpanelRegion = DEFAULT_MIXPANEL_REGION,
): string => {
  const appOrigin = getMixpanelEndpoints(region).appOrigin;
  const encoded = encodeURIComponent(eventName);

  return `${appOrigin}/project/${projectId}/view/${workspaceId}/app/events#${encoded}`;
};
