import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildChangeBlockCommentBody,
  buildMixpanelSectionForComment,
  buildReviewCommentBody,
  collectReviewCommentTargets,
  resolveEventMixpanelContext,
} from "./reviewComments.js";
import { collectReviewCommentBlockTargets } from "./reviewCommentBlocks.js";
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
          visibility:
            "You'll be able to measure how many users reach the checkout retry step and trend that volume over time.",
        },
      ],
    },
  ],
  newEvents: ["checkout_retry_viewed"],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView"],
  helpersCreated: [],
  deduplicationDecisions: [],
  changeBlocks: [
    {
      file: "src/pages/CheckoutRetryPage.tsx",
      startLine: 8,
      endLine: 8,
      visibility:
        "You'll be able to measure how many users reach the checkout retry step and trend that volume over time.",
      events: ["checkout_retry_viewed"],
    },
  ],
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

  test("given change blocks this should collect one target per block", () => {
    const blocks = collectReviewCommentBlockTargets(sampleReport);

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.startLine, 8);
    assert.equal(blocks[0]?.events.length, 1);
  });

  test("given change block this should build grouped review comment body", () => {
    const block = collectReviewCommentBlockTargets(sampleReport)[0]!;
    const mixpanel = resolveEventMixpanelContext(
      "checkout_retry_viewed",
      samplePlan,
      undefined,
      "123",
      "456",
    );
    const body = buildChangeBlockCommentBody(block, new Map([["checkout_retry_viewed", mixpanel]]));

    assert.match(body, /What you'll see in analytics/);
    assert.match(body, /checkout retry step/);
    assert.match(body, /lines 8-8|line 8/);
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

    assert.match(body, /What you'll see in analytics/);
    assert.match(body, /checkout retry step/);
    assert.match(body, /Mixpanel/);
    assert.match(body, /Cursor Cloud Agent/);
  });

  test("given event without dashboard report this should explain events-only destination", () => {
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Reports Viewed Trend",
          description: "Daily trend",
          event: "reports_viewed",
          reason: "Page view",
        },
      ],
    };
    const body = buildChangeBlockCommentBody(
      {
        file: "src/pages/ReportsPage.tsx",
        startLine: 76,
        endLine: 76,
        visibility: "[Events only] Filter usage tracked in Events.",
        events: [
          {
            name: "reports_filter_selected",
            properties: { page: "reports", filter: "all" },
            trigger: "trackAction on filter click",
          },
        ],
      },
      new Map([
        [
          "reports_filter_selected",
          resolveEventMixpanelContext("reports_filter_selected", plan, undefined, "123", "456"),
        ],
      ]),
      plan,
    );

    assert.match(body, /Mixpanel destination/);
    assert.match(body, /\*\*Events only\*\*/);
    assert.match(body, /Live View/);
  });

  test("given event with dashboard report this should show board report destination", () => {
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Reports Viewed Trend",
          description: "Daily trend",
          event: "reports_viewed",
          reason: "Page view",
        },
      ],
    };
    const body = buildChangeBlockCommentBody(
      {
        file: "src/pages/ReportsPage.tsx",
        startLine: 8,
        endLine: 8,
        visibility: "[Board report] Daily reports page traffic.",
        events: [
          {
            name: "reports_viewed",
            properties: { page: "reports" },
            trigger: "trackPageView on mount",
          },
        ],
      },
      new Map([
        [
          "reports_viewed",
          resolveEventMixpanelContext("reports_viewed", plan, undefined, "123", "456"),
        ],
      ]),
      plan,
    );

    assert.match(body, /\*\*Board report\*\*/);
    assert.match(body, /Reports Viewed Trend/);
  });

  test("given six events and two board reports this should split mixpanel mapping sections", () => {
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Reports Viewed Trend",
          description: "Daily trend",
          event: "reports_viewed",
          reason: "Page view",
        },
        {
          type: "insights",
          name: "Reports Generate Report Clicked Trend",
          description: "Daily trend",
          event: "reports_generate_report_clicked",
          reason: "Primary action",
        },
      ],
    };
    const lines = buildMixpanelSectionForComment(
      {
        ...sampleReport,
        newEvents: [
          "reports_viewed",
          "reports_filter_selected",
          "reports_generate_report_clicked",
        ],
      },
      plan,
      undefined,
      "123",
      "456",
    );
    const body = lines.join("\n");

    assert.match(body, /Mixpanel links/);
    assert.match(body, /Board report/);
    assert.match(body, /Events only/);
    assert.match(body, /reports_filter_selected/);
  });
});
