import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHANGE_BLOCK_LINE_GAP,
  clusterEventsIntoChangeBlocks,
  collectReviewCommentBlockTargets,
} from "./reviewCommentBlocks.js";
import type { IInstrumentReport } from "./types.js";

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
          justification: "Page view on mount.",
        },
        {
          name: "checkout_retry_back_clicked",
          properties: { page: "checkout_retry", step: "retry" },
          trigger: "trackAction on click",
          line: 24,
          justification: "Back link click.",
        },
      ],
    },
  ],
  newEvents: ["checkout_retry_viewed", "checkout_retry_back_clicked"],
  filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
  helpersUsed: ["trackPageView"],
  helpersCreated: [],
  deduplicationDecisions: [],
  changeBlocks: [],
};

describe("packages/orchestrator/src/reviewCommentBlocks.ts", () => {
  test("given distant events on one file this should cluster into separate blocks", () => {
    const blocks = clusterEventsIntoChangeBlocks(sampleReport);

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.startLine, 8);
    assert.equal(blocks[1]?.startLine, 24);
    assert.equal(blocks[0]?.events.length, 1);
    assert.equal(blocks[1]?.events.length, 1);
  });

  test("given nearby events this should group into one block", () => {
    const blocks = clusterEventsIntoChangeBlocks({
      ...sampleReport,
      pages: [
        {
          name: "CheckoutRetryPage",
          file: "src/pages/CheckoutRetryPage.tsx",
          events: [
            {
              name: "checkout_retry_viewed",
              properties: { page: "checkout_retry" },
              trigger: "mount",
              line: 8,
              justification: "Mount",
            },
            {
              name: "checkout_retry_back_clicked",
              properties: { page: "checkout_retry" },
              trigger: "click",
              line: 10,
              justification: "Click",
            },
          ],
        },
      ],
    });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.startLine, 8);
    assert.equal(blocks[0]?.endLine, 10);
    assert.equal(blocks[0]?.events.length, 2);
  });

  test("given explicit changeBlocks this should prefer report blocks", () => {
    const blocks = collectReviewCommentBlockTargets({
      ...sampleReport,
      changeBlocks: [
        {
          file: "src/pages/CheckoutRetryPage.tsx",
          startLine: 8,
          endLine: 11,
          justification: "Mount block",
          events: ["checkout_retry_viewed"],
        },
        {
          file: "src/lib/analytics.ts",
          startLine: 42,
          endLine: 55,
          justification: "Added shared helper for retry funnel.",
          events: [],
        },
      ],
      filesChanged: ["src/pages/CheckoutRetryPage.tsx", "src/lib/analytics.ts"],
    });

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.events[0]?.name, "checkout_retry_viewed");
    assert.equal(blocks[1]?.events.length, 0);
    assert.match(blocks[1]?.justification ?? "", /shared helper/);
  });

  test("given line gap constant this should exceed one for distant events", () => {
    assert.ok(24 - 8 > CHANGE_BLOCK_LINE_GAP);
  });
});
