import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { IAnalyticsCatalog, IInstrumentConfig } from "./types.js";

const EXPORT_PATTERN =
  /export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)\s*(?:=|\()/g;

const HELPER_HINTS = ["track", "page", "action", "event", "analytics"];

export const discoverAnalyticsCatalog = (
  workspaceRoot: string,
  config: IInstrumentConfig,
): IAnalyticsCatalog => {
  const modulePath = config.paths.analytics;
  const absolutePath = join(workspaceRoot, modulePath);

  try {
    const source = readFileSync(absolutePath, "utf8");
    const helpers: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = EXPORT_PATTERN.exec(source)) !== null) {
      const name = match[1];

      if (name && name !== config.analytics.wrapper.initFunction) {
        helpers.push(name);
      }
    }

    const trackingHelpers = helpers.filter((name) =>
      HELPER_HINTS.some((hint) => name.toLowerCase().includes(hint)),
    );

    return {
      module: modulePath,
      helpers: [...new Set(helpers)],
      trackingHelpers,
      hasTrackPageView: helpers.includes("trackPageView"),
      hasTrackAction: helpers.includes("trackAction"),
    };
  } catch {
    return {
      module: modulePath,
      helpers: [],
      trackingHelpers: [],
      hasTrackPageView: false,
      hasTrackAction: false,
    };
  }
};
