import mixpanel from 'mixpanel-browser';

export type TrackProps = Record<string, string | number | boolean | null | undefined>;

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
