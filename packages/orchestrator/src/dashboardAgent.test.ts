import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildDashboardPlanDeterministic } from "./dashboardAgent.js";
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

    assert.ok(plan.reports.length >= 2);
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
});
