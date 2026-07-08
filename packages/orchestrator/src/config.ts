import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  instrumentConfigSchema,
  mixpanelEnvConfigSchema,
  type IInstrumentConfig,
  type IMixpanelEnvConfig,
} from "./types.js";

const MIXPANEL_ENV_KEYS = {
  serviceAccountUsername: "MIXPANEL_SERVICE_ACCOUNT_USERNAME",
  serviceAccountSecret: "MIXPANEL_SERVICE_ACCOUNT_SECRET",
  projectId: "MIXPANEL_PROJECT_ID",
  workspaceId: "MIXPANEL_WORKSPACE_ID",
  dashboardId: "MIXPANEL_DASHBOARD_ID",
  region: "MIXPANEL_REGION",
} as const;

export const loadInstrumentConfig = (configPath: string): IInstrumentConfig => {
  const absolutePath = resolve(configPath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  return instrumentConfigSchema.parse(parsed);
};

export const resolveMixpanelEnv = (
  _config: IInstrumentConfig,
): IMixpanelEnvConfig | null => {
  const envValues = {
    serviceAccountUsername: process.env[MIXPANEL_ENV_KEYS.serviceAccountUsername],
    serviceAccountSecret: process.env[MIXPANEL_ENV_KEYS.serviceAccountSecret],
    projectId: process.env[MIXPANEL_ENV_KEYS.projectId],
    workspaceId: process.env[MIXPANEL_ENV_KEYS.workspaceId],
    dashboardId: process.env[MIXPANEL_ENV_KEYS.dashboardId],
    region: process.env[MIXPANEL_ENV_KEYS.region],
  };

  const hasRequired =
    envValues.serviceAccountUsername &&
    envValues.serviceAccountSecret &&
    envValues.projectId &&
    envValues.workspaceId;

  if (!hasRequired) {
    return null;
  }

  return mixpanelEnvConfigSchema.parse({
    serviceAccountUsername: envValues.serviceAccountUsername,
    serviceAccountSecret: envValues.serviceAccountSecret,
    projectId: envValues.projectId,
    workspaceId: envValues.workspaceId,
    dashboardId: envValues.dashboardId,
    region:
      envValues.region === "us" || envValues.region === "in"
        ? envValues.region
        : undefined,
  });
};

export const getDefaultScanGlobs = (config: IInstrumentConfig): string[] => {
  const configured = config.scan?.includeGlobs;

  if (configured && configured.length > 0) {
    return configured;
  }

  return [`${config.paths.pages}/**/*.{tsx,ts,jsx,js}`];
};

export const getExcludeGlobs = (config: IInstrumentConfig): string[] => {
  return config.scan?.excludeGlobs ?? [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
  ];
};
