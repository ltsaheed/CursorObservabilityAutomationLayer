import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildClusteredVisibility,
  CHANGE_BLOCK_LINE_GAP,
  clusterEventsIntoChangeBlocks,
  collectReviewCommentBlockTargets,
  inferEventVisibility,
  resolveChangeBlockVisibility,
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
          visibility: "You'll see daily retry page traffic.",
        },
        {
          name: "checkout_retry_back_clicked",
          properties: { page: "checkout_retry", step: "retry" },
          trigger: "trackAction on click",
          line: 24,
          justification: "Back link click.",
          visibility: "You'll see how often users abandon retry.",
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
    assert.match(blocks[0]?.visibility ?? "", /retry page traffic/);
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
              visibility: "Traffic visibility.",
            },
            {
              name: "checkout_retry_back_clicked",
              properties: { page: "checkout_retry" },
              trigger: "click",
              line: 10,
              visibility: "Drop-off visibility.",
            },
          ],
        },
      ],
    });

    assert.equal(blocks.length, 1);
    assert.match(blocks[0]?.visibility ?? "", /Traffic visibility/);
    assert.match(blocks[0]?.visibility ?? "", /Drop-off visibility/);
  });

  test("given explicit changeBlocks this should prefer block visibility", () => {
    const blocks = collectReviewCommentBlockTargets({
      ...sampleReport,
      changeBlocks: [
        {
          file: "src/pages/CheckoutRetryPage.tsx",
          startLine: 8,
          endLine: 11,
          visibility: "Product teams can trend checkout retry volume in Mixpanel.",
          events: ["checkout_retry_viewed"],
        },
        {
          file: "src/lib/analytics.ts",
          startLine: 42,
          endLine: 55,
          visibility: "Shared helper gives consistent retry funnel events across pages.",
          events: [],
        },
      ],
      filesChanged: ["src/pages/CheckoutRetryPage.tsx", "src/lib/analytics.ts"],
    });

    assert.equal(blocks.length, 2);
    assert.match(blocks[0]?.visibility, /trend checkout retry volume/);
    assert.match(blocks[1]?.visibility, /Shared helper/);
  });

  test("given legacy block justification this should still resolve visibility", () => {
    const visibility = resolveChangeBlockVisibility(
      {
        justification: "Legacy technical note only.",
      },
      [],
    );

    assert.match(visibility, /Legacy technical note/);
  });

  test("given page view event without visibility this should infer analytics wording", () => {
    const text = inferEventVisibility({
      name: "checkout_retry_viewed",
      properties: { page: "checkout_retry" },
      trigger: "mount",
    });

    assert.match(text, /Measure how many users reach this step/);
  });

  test("given line gap constant this should exceed one for distant events", () => {
    assert.ok(24 - 8 > CHANGE_BLOCK_LINE_GAP);
  });

  test("given empty helper block this should describe shared analytics value", () => {
    assert.match(buildClusteredVisibility([]), /product and growth teams/);
  });
});
