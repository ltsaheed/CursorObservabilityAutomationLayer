import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildReviewCommentBody,
  collectReviewCommentTargets,
  resolveEventMixpanelContext,
} from "./reviewComments.js";
import type { IDashboardPlan, IInstrumentReport } from "./types.js";

const sampleReport: IInstrumentReport = {
  version: "1",
  prSummary: "Instrumented checkout retry",
  pages: [
    {
      name: "CheckoutRetryPage",
      file: "src/pages/CheckoutRetryPage.tsx",
      events: [
        {
          name: "checkout_retry_viewed",
          properties: { page: "checkout_retry", step: "retry" },
          trigger: "trackPageView on mount",
          line: 8,
          justification: "Page view required on mount per ADR-031.",
        },
      ],
    },
  ],
  newEvents: ["checkout_retry_viewed"],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView"],
  helpersCreated: [],
  deduplicationDecisions: [],
};

const samplePlan: IDashboardPlan = {
  decisions: [{ summary: "Plan", reason: "Test" }],
  reports: [
    {
      type: "insights",
      name: "Checkout Retry Viewed Trend",
      description: "Daily trend",
      event: "checkout_retry_viewed",
      reason: "New page view",
    },
  ],
};

describe("packages/orchestrator/src/reviewComments.ts", () => {
  test("given report events with lines this should collect review comment targets", () => {
    const targets = collectReviewCommentTargets(sampleReport);

    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.line, 8);
    assert.equal(targets[0]?.file, "src/pages/CheckoutRetryPage.tsx");
  });

  test("given no new events this should skip inline review comment targets", () => {
    const targets = collectReviewCommentTargets({
      ...sampleReport,
      newEvents: [],
      filesChanged: [],
    });

    assert.equal(targets.length, 0);
  });

  test("given events outside filesChanged this should skip inline review comment targets", () => {
    const targets = collectReviewCommentTargets({
      ...sampleReport,
      filesChanged: ["src/pages/HomePage.tsx"],
    });

    assert.equal(targets.length, 0);
  });

  test("given dashboard plan this should resolve planned Mixpanel context", () => {
    const context = resolveEventMixpanelContext(
      "checkout_retry_viewed",
      samplePlan,
      undefined,
      "123",
      "456",
    );

    assert.equal(context.reportName, "Checkout Retry Viewed Trend");
    assert.equal(context.plannedOnly, true);
    assert.match(context.eventsUrl ?? "", /checkout_retry_viewed/);
  });

  test("given event with justification this should build review comment body", () => {
    const event = sampleReport.pages[0]!.events[0]!;
    const body = buildReviewCommentBody(
      event,
      "src/pages/CheckoutRetryPage.tsx",
      resolveEventMixpanelContext("checkout_retry_viewed", samplePlan, undefined, "123", "456"),
    );

    assert.match(body, /Why this change/);
    assert.match(body, /checkout_retry_viewed/);
    assert.match(body, /Mixpanel/);
    assert.match(body, /Cursor Cloud Agent/);
  });
});
