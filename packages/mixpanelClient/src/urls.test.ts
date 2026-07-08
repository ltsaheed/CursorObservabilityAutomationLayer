import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildDashboardUrl, buildMixpanelEventsUrl, buildMixpanelReportUrl } from "./urls.js";

describe("packages/mixpanelClient/src/urls.ts", () => {
  test("given dashboard and bookmark ids this should build a report deep link", () => {
    const url = buildMixpanelReportUrl("12345", "67890", 111, 222);

    assert.equal(
      url,
      'https://mixpanel.com/project/12345/view/67890/app/boards#id=111&editor-card-id="report-222"',
    );
  });

  test("given a dashboard id this should build a dashboard url", () => {
    const url = buildDashboardUrl("12345", "67890", 111);

    assert.equal(
      url,
      "https://mixpanel.com/project/12345/view/67890/app/boards#id=111",
    );
  });

  test("given an event name this should build a Mixpanel events url", () => {
    const url = buildMixpanelEventsUrl("12345", "67890", "checkout_retry_viewed");

    assert.equal(
      url,
      "https://mixpanel.com/project/12345/view/67890/app/events#checkout_retry_viewed",
    );
  });
});
