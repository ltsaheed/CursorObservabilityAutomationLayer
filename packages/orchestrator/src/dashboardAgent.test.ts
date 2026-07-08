import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDashboardPlanDeterministic,
  capDashboardPlanReports,
  MAX_REPORTS_PER_PR,
} from "./dashboardAgent.js";
import type { IInstrumentReport } from "./types.js";

const checkoutRetryReport: IInstrumentReport = {
  version: "1",
  prSummary: "Instrumented checkout retry page",
  pages: [
    {
      name: "CheckoutRetryPage",
      file: "src/pages/CheckoutRetryPage.tsx",
      events: [
        {
          name: "checkout_retry_viewed",
          properties: { page: "checkout_retry", step: "retry" },
          trigger: "useEffect on mount",
        },
        {
          name: "checkout_retry_back_clicked",
          properties: {
            page: "checkout_retry",
            step: "retry",
            cta: "back_to_checkout",
          },
          trigger: "Link onClick handler",
        },
      ],
    },
  ],
  newEvents: ["checkout_retry_viewed", "checkout_retry_back_clicked"],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView", "trackAction"],
  helpersCreated: [],
  deduplicationDecisions: [],
  changeBlocks: [],
};

describe("packages/orchestrator/src/dashboardAgent.ts", () => {
  test("given checkout retry report this should build insights for new events", () => {
    const plan = buildDashboardPlanDeterministic(checkoutRetryReport);

    assert.equal(plan.reports.length, MAX_REPORTS_PER_PR);
    assert.ok(
      plan.reports.some(
        (report) => report.type === "insights" && report.event === "checkout_retry_viewed",
      ),
    );
    assert.ok(
      plan.reports.some(
        (report) =>
          report.type === "insights" && report.event === "checkout_retry_back_clicked",
      ),
    );
  });

  test("given deterministic planner this should include decision metadata", () => {
    const plan = buildDashboardPlanDeterministic(checkoutRetryReport);

    assert.equal(plan.decisions.length, 1);
    assert.match(plan.decisions[0]?.summary ?? "", /Deterministic/i);
  });

  test("given many new events this should prioritize the two most important events", () => {
    const plan = buildDashboardPlanDeterministic({
      ...checkoutRetryReport,
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
      changeBlocks: [
        {
          file: "src/pages/CheckoutRetryPage.tsx",
          startLine: 8,
          endLine: 8,
          visibility: "Measure checkout retry traffic after failed payments.",
          events: ["checkout_retry_viewed"],
        },
      ],
    });

    assert.equal(plan.reports.length, MAX_REPORTS_PER_PR);
    assert.ok(
      plan.decisions.some((decision) =>
        decision.summary.includes(`Prioritized ${MAX_REPORTS_PER_PR} of 4 new events`),
      ),
    );
    assert.ok(
      plan.reports.some(
        (report) => report.type === "insights" && report.event === "checkout_retry_viewed",
      ),
    );
    assert.ok(
      plan.reports.some(
        (report) =>
          report.type === "insights" && report.event === "checkout_retry_submit_clicked",
      ),
    );
    assert.ok(
      !plan.reports.some(
        (report) => report.type === "insights" && report.event === "checkout_viewed",
      ),
    );
  });

  test("given a plan with more than two reports capDashboardPlanReports this should keep highest-priority events", () => {
    const capped = capDashboardPlanReports(
      {
        decisions: [{ summary: "Test", reason: "Test" }],
        reports: [
          {
            type: "insights",
            name: "Back",
            description: "Back",
            event: "checkout_retry_back_clicked",
            reason: "Back",
          },
          {
            type: "insights",
            name: "Checkout",
            description: "Checkout",
            event: "checkout_viewed",
            reason: "Checkout",
          },
          {
            type: "insights",
            name: "Submit",
            description: "Submit",
            event: "checkout_retry_submit_clicked",
            reason: "Submit",
          },
        ],
      },
      {
        ...checkoutRetryReport,
        pages: [
          {
            name: "CheckoutRetryPage",
            file: "src/pages/CheckoutRetryPage.tsx",
            events: [
              {
                name: "checkout_retry_viewed",
                properties: { page: "checkout_retry" },
                trigger: "useEffect on mount",
              },
              {
                name: "checkout_retry_back_clicked",
                properties: { page: "checkout_retry" },
                trigger: "Link onClick handler",
              },
              {
                name: "checkout_retry_submit_clicked",
                properties: { page: "checkout_retry" },
                trigger: "Button onClick handler",
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
      },
    );

    assert.equal(capped.reports.length, MAX_REPORTS_PER_PR);

    const insightEvents = capped.reports
      .filter((report) => report.type === "insights")
      .map((report) => report.event);

    assert.ok(insightEvents.includes("checkout_retry_submit_clicked"));
    assert.ok(!insightEvents.includes("checkout_retry_back_clicked"));
  });

  test("given empty newEvents this should return no dashboard reports", () => {
    const plan = buildDashboardPlanDeterministic({
      ...checkoutRetryReport,
      newEvents: [],
    });

    assert.equal(plan.reports.length, 0);
    assert.match(plan.decisions[0]?.summary ?? "", /No dashboard reports/i);
  });
});
