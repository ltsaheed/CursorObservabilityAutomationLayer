import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  extractReportFromAgentResult,
  normalizeReportPayload,
  parseInstrumentReportJson,
} from "./reportLoader.js";

describe("packages/orchestrator/src/reportLoader.ts", () => {
  test("given partial report json this should apply defaults", () => {
    const normalized = normalizeReportPayload({
      prSummary: "Added tracking",
      pages: [],
      newEvents: ["checkout_retry_viewed"],
      filesChanged: ["src/pages/CheckoutRetryPage.tsx"],
    });

    const parsed = parseInstrumentReportJson(JSON.stringify(normalized));

    assert.ok(parsed.report);
    assert.deepEqual(parsed.report?.helpersUsed, []);
  });

  test("given pages without name this should derive name from file path", () => {
    const normalized = normalizeReportPayload({
      prSummary: "Added tracking",
      pages: [
        {
          file: "src/pages/CheckoutRetryPage.tsx",
          events: [
            {
              name: "checkout_retry_viewed",
              properties: { page: "checkout_retry" },
              trigger: "trackPageView on mount",
            },
          ],
        },
      ],
    });

    const parsed = parseInstrumentReportJson(JSON.stringify(normalized));

    assert.ok(parsed.report);
    assert.equal(parsed.report?.pages[0]?.name, "CheckoutRetryPage");
    assert.deepEqual(parsed.report?.newEvents, ["checkout_retry_viewed"]);
  });

  test("given report in markdown fence this should extract from agent result", () => {
    const text = `
Done. Here is the report:

\`\`\`json
{
  "version": "1",
  "prSummary": "Instrumented checkout retry",
  "pages": [{
    "name": "CheckoutRetryPage",
    "file": "src/pages/CheckoutRetryPage.tsx",
    "events": [{
      "name": "checkout_retry_viewed",
      "properties": { "page": "checkout_retry" },
      "trigger": "trackPageView on mount"
    }]
  }],
  "newEvents": ["checkout_retry_viewed"],
  "filesChanged": ["src/pages/CheckoutRetryPage.tsx"]
}
\`\`\`
`;

    const result = extractReportFromAgentResult(text);

    assert.ok(result.report);
    assert.equal(result.report?.newEvents[0], "checkout_retry_viewed");
  });
});
