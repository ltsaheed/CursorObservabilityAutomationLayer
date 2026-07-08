import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createProgressReporter } from "./progressReporter.js";
import { runStandardsReviewLoop } from "./standardsReviewLoop.js";
import type { ICoverageAssessment, IInstrumentReport } from "./types.js";

const sampleAssessment: ICoverageAssessment = {
  scannedFiles: ["src/pages/CheckoutRetryPage.tsx"],
  gaps: [
    {
      file: "src/pages/CheckoutRetryPage.tsx",
      kind: "missing_page_view",
      description: "No page view event",
      pageName: "CheckoutRetryPage",
    },
  ],
  summary: "1 gap found",
};

const sampleReport: IInstrumentReport = {
  version: "1",
  prSummary: "Added retry page tracking",
  pages: [
    {
      name: "CheckoutRetryPage",
      file: "src/pages/CheckoutRetryPage.tsx",
      events: [
        {
          name: "checkout_retry_viewed",
          properties: { page: "checkout_retry" },
          trigger: "mount",
        },
      ],
    },
  ],
  newEvents: ["checkout_retry_viewed"],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView"],
  helpersCreated: [],
  deduplicationDecisions: [],
  changeBlocks: [],
};

describe("packages/orchestrator/src/standardsReviewLoop.ts", () => {
  test("given dry-run first fail then pass this should complete review loop", async () => {
    const reporter = createProgressReporter();

    const result = await runStandardsReviewLoop({
      workspaceRoot: process.cwd(),
      assessment: sampleAssessment,
      report: sampleReport,
      dryRun: true,
      reporter,
    });

    assert.equal(result.review.passed, true);
  });
});
