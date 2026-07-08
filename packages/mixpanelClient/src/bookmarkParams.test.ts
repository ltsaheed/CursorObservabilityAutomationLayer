import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildBookmarkParams,
  buildFunnelsBookmarkParams,
  buildInsightsBookmarkParams,
} from "./bookmarkParams.js";
import type { IFunnelsReportPlan, IInsightsReportPlan } from "./types.js";

describe("packages/mixpanelClient/src/bookmarkParams.ts", () => {
  test("given insights plan input this should build Mixpanel sections bookmark params", () => {
    const plan: IInsightsReportPlan = {
      type: "insights",
      name: "Checkout Retry Views",
      description: "Daily views",
      event: "checkout_retry_viewed",
      reason: "New page added",
    };
    const params = buildInsightsBookmarkParams(plan);

    const sections = params.sections as Record<string, unknown>;
    const show = sections.show as Array<Record<string, unknown>>;
    const behavior = show[0]?.behavior as Record<string, unknown>;
    const time = sections.time as Array<Record<string, unknown>>;

    assert.deepEqual(behavior.value, { name: "checkout_retry_viewed" });
    assert.equal(time[0]?.dateRangeType, "in the last");
    assert.equal(time[0]?.value, 30);
    assert.deepEqual(params.displayOptions, {
      chartType: "line",
      analysis: "linear",
    });
  });

  test("given funnel plan input this should build funnel sections bookmark params", () => {
    const plan: IFunnelsReportPlan = {
      type: "funnels",
      name: "Checkout Retry Funnel",
      description: "Retry flow",
      steps: ["checkout_started", "checkout_retry_viewed"],
      reason: "Multi-step flow",
    };
    const params = buildFunnelsBookmarkParams(plan);

    const sections = params.sections as Record<string, unknown>;
    const show = sections.show as Array<Record<string, unknown>>;
    const behavior = show[0]?.behavior as Record<string, unknown>;
    const behaviors = behavior.behaviors as Array<Record<string, unknown>>;
    const measurement = show[0]?.measurement as Record<string, unknown>;

    assert.equal(behavior.type, "funnel");
    assert.equal(behaviors.length, 2);
    assert.equal(measurement.math, "conversion_rate_unique");
  });

  test("given report plan type this should delegate to the matching builder", () => {
    const params = buildBookmarkParams({
      type: "insights",
      name: "Checkout Retry Views",
      description: "Daily views",
      event: "checkout_retry_viewed",
      reason: "New page added",
    });

    assert.ok((params.sections as Record<string, unknown>).show);
  });
});
