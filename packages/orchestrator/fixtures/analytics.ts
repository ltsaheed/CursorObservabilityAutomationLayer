import mixpanel from 'mixpanel-browser';

export type TrackProps = Record<string, string | number | boolean | null | undefined>;

type MixpanelRegion = 'us' | 'eu' | 'in';

const MIXPANEL_API_HOSTS: Record<MixpanelRegion, string> = {
  us: 'https://api.mixpanel.com',
  eu: 'https://api-eu.mixpanel.com',
  in: 'https://api-in.mixpanel.com',
};

const resolveMixpanelRegion = (): MixpanelRegion => {
  const region = import.meta.env.VITE_MIXPANEL_REGION?.toLowerCase();

  if (region === 'us' || region === 'in') {
    return region;
  }

  return 'eu';
};

let isInitialized = false;

export const initMixpanel = (): void => {
  if (isInitialized) {
    return;
  }

  const token = import.meta.env.VITE_MIXPANEL_TOKEN;

  if (!token) {
    console.warn('[analytics] VITE_MIXPANEL_TOKEN is not set; tracking disabled');
    return;
  }

  mixpanel.init(token, {
    debug: import.meta.env.VITE_MIXPANEL_DEBUG === 'true',
    track_pageview: false,
    api_host: MIXPANEL_API_HOSTS[resolveMixpanelRegion()],
  });

  isInitialized = true;
};

export const track = (name: string, props?: TrackProps): void => {
  if (!isInitialized) {
    return;
  }

  mixpanel.track(name, props);
};

export const trackPageView = (page: string, props?: TrackProps): void => {
  track(`${page}_viewed`, { page, ...props });
};

export const trackAction = (
  page: string,
  action: string,
  props?: TrackProps,
): void => {
  track(`${page}_${action}`, { page, ...props });
};
