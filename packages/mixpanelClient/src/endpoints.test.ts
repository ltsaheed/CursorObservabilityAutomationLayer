import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_MIXPANEL_REGION,
  getMixpanelEndpoints,
  resolveMixpanelRegion,
} from "./endpoints.js";

describe("packages/mixpanelClient/src/endpoints.ts", () => {
  test("given no region this should default to eu endpoints", () => {
    assert.equal(resolveMixpanelRegion(undefined), DEFAULT_MIXPANEL_REGION);
    assert.equal(
      getMixpanelEndpoints().apiBase,
      "https://eu.mixpanel.com/api/app/",
    );
  });

  test("given us region this should use us endpoints", () => {
    assert.equal(resolveMixpanelRegion("us"), "us");
    assert.equal(
      getMixpanelEndpoints("us").apiBase,
      "https://mixpanel.com/api/app/",
    );
  });

  test("given eu region this should use eu endpoints", () => {
    assert.equal(resolveMixpanelRegion("eu"), "eu");
    assert.equal(
      getMixpanelEndpoints("eu").appOrigin,
      "https://eu.mixpanel.com",
    );
  });
});
