import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  rankNewEventsForReporting,
  selectPrioritizedEvents,
  splitNewEventsByDashboardCoverage,
} from "./eventPrioritization.js";
import type { IDashboardPlan, IInstrumentReport } from "./types.js";

const multiEventReport: IInstrumentReport = {
  version: "1",
  prSummary: "Instrumented checkout retry flow",
  pages: [
    {
      name: "CheckoutRetryPage",
      file: "src/pages/CheckoutRetryPage.tsx",
      events: [
        {
          name: "checkout_retry_viewed",
          properties: { page: "checkout_retry" },
          trigger: "useEffect on mount",
          visibility: "Measure checkout retry traffic and payment failure spikes.",
        },
        {
          name: "checkout_retry_back_clicked",
          properties: { page: "checkout_retry", cta: "back_to_checkout" },
          trigger: "Link onClick handler",
          visibility: "Track drop-off when users abandon retry.",
        },
        {
          name: "checkout_retry_submit_clicked",
          properties: { page: "checkout_retry", cta: "submit_payment" },
          trigger: "Button onClick handler",
          visibility: "Track conversion when users submit payment on retry.",
        },
      ],
    },
  ],
  newEvents: [
    "checkout_viewed",
    "checkout_retry_viewed",
    "checkout_retry_back_clicked",
    "checkout_retry_submit_clicked",
  ],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView", "trackAction"],
  helpersCreated: [],
  deduplicationDecisions: [],
  changeBlocks: [
    {
      file: "src/pages/CheckoutRetryPage.tsx",
      startLine: 8,
      endLine: 8,
      visibility: "Measure checkout retry traffic after failed payments.",
      events: ["checkout_retry_viewed"],
    },
  ],
};

describe("packages/orchestrator/src/eventPrioritization.ts", () => {
  test("given multiple new events this should rank primary page view and high-intent action highest", () => {
    const ranked = rankNewEventsForReporting(multiEventReport);

    assert.equal(ranked[0]?.eventName, "checkout_retry_viewed");
    assert.equal(ranked[1]?.eventName, "checkout_retry_submit_clicked");
  });

  test("given more new events than report slots this should select the top two", () => {
    const { events } = selectPrioritizedEvents(multiEventReport, 2);

    assert.deepEqual(events, ["checkout_retry_viewed", "checkout_retry_submit_clicked"]);
  });

  test("given dashboard plan with two reports this should split covered vs tracked-only events", () => {
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
    const newEvents = [
      "reports_viewed",
      "reports_filter_selected",
      "reports_report_selected",
      "reports_generate_report_clicked",
      "reports_export_pdf_clicked",
      "reports_schedule_report_clicked",
    ];
    const split = splitNewEventsByDashboardCoverage(newEvents, plan);

    assert.deepEqual(split.withDashboardReport, [
      "reports_viewed",
      "reports_generate_report_clicked",
    ]);
    assert.equal(split.trackedOnly.length, 4);
  });
});
