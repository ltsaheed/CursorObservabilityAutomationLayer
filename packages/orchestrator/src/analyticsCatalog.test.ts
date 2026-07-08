import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { discoverAnalyticsCatalog } from "./analyticsCatalog.js";
import type { IInstrumentConfig } from "./types.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/analytics.ts",
);

const baseConfig: IInstrumentConfig = {
  framework: "vite-react",
  paths: {
    pages: "src/pages",
    analytics: "src/lib/analytics.ts",
  },
  analytics: {
    wrapper: {
      module: "src/lib/analytics.ts",
      initFunction: "initMixpanel",
      trackFunction: "track",
    },
    requiredEvents: {
      pageView: "{page}_viewed",
      userAction: "{page}_{action}",
    },
  },
};

describe("packages/orchestrator/src/analyticsCatalog.ts", () => {
  test("given analytics module with helpers this should list trackPageView and trackAction", () => {
    const workspace = join(tmpdir(), `instrument-catalog-${Date.now()}`);
    mkdirSync(join(workspace, "src/lib"), { recursive: true });

    writeFileSync(
      join(workspace, "src/lib/analytics.ts"),
      readFileSync(fixturePath, "utf8"),
    );

    const catalog = discoverAnalyticsCatalog(workspace, baseConfig);

    assert.equal(catalog.hasTrackPageView, true);
    assert.equal(catalog.hasTrackAction, true);
    assert.ok(catalog.helpers.includes("trackPageView"));
  });
});
