export type IMixpanelRegion = "us" | "eu" | "in";

export interface IMixpanelEndpoints {
  appOrigin: string;
  apiBase: string;
}

export const MIXPANEL_ENDPOINTS: Record<IMixpanelRegion, IMixpanelEndpoints> = {
  us: {
    appOrigin: "https://mixpanel.com",
    apiBase: "https://mixpanel.com/api/app/",
  },
  eu: {
    appOrigin: "https://eu.mixpanel.com",
    apiBase: "https://eu.mixpanel.com/api/app/",
  },
  in: {
    appOrigin: "https://in.mixpanel.com",
    apiBase: "https://in.mixpanel.com/api/app/",
  },
};

export const DEFAULT_MIXPANEL_REGION: IMixpanelRegion = "eu";

export const resolveMixpanelRegion = (value?: string | null): IMixpanelRegion => {
  if (value === "us" || value === "eu" || value === "in") {
    return value;
  }

  return DEFAULT_MIXPANEL_REGION;
};

export const getMixpanelEndpoints = (
  region: IMixpanelRegion = DEFAULT_MIXPANEL_REGION,
): IMixpanelEndpoints => {
  return MIXPANEL_ENDPOINTS[region];
};
