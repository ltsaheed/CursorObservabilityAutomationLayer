import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildDashboardUrl, buildMixpanelEventsUrl, buildMixpanelReportUrl } from "./urls.js";

describe("packages/mixpanelClient/src/urls.ts", () => {
  test("given dashboard and bookmark ids this should build a report deep link", () => {
    const url = buildMixpanelReportUrl("12345", "67890", 111, 222);

    assert.equal(
      url,
      'https://eu.mixpanel.com/project/12345/view/67890/app/boards#id=111&editor-card-id="report-222"',
    );
  });

  test("given a dashboard id this should build a dashboard url", () => {
    const url = buildDashboardUrl("12345", "67890", 111);

    assert.equal(
      url,
      "https://eu.mixpanel.com/project/12345/view/67890/app/boards#id=111",
    );
  });

  test("given an event name this should build a Mixpanel events url", () => {
    const url = buildMixpanelEventsUrl("12345", "67890", "checkout_retry_viewed");

    assert.equal(
      url,
      "https://eu.mixpanel.com/project/12345/view/67890/app/events#checkout_retry_viewed",
    );
  });

  test("given us region this should build us dashboard links", () => {
    const url = buildDashboardUrl("4041737", "4537984", 11349882, "us");

    assert.equal(
      url,
      "https://mixpanel.com/project/4041737/view/4537984/app/boards#id=11349882",
    );
  });

  test("given eu region this should build regional dashboard links", () => {
    const url = buildDashboardUrl("4041737", "4537984", 11349882, "eu");

    assert.equal(
      url,
      "https://eu.mixpanel.com/project/4041737/view/4537984/app/boards#id=11349882",
    );
  });
});
