import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  appendRunHistory,
  computeOverallStatus,
  parseRunHistoryFromComment,
  renderCommentBody,
} from "./github.js";
import type { IProgressReporterState } from "./types.js";

describe("packages/orchestrator/src/github.ts", () => {
  test("given failed phase this should compute failed overall status", () => {
    const state: IProgressReporterState = {
      phases: [
        { name: "pre-scan", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
        { name: "code-agent", status: "failed", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
      ],
      summaryLines: [],
    };

    assert.equal(computeOverallStatus(state), "failed");
  });

  test("given passed review this should compute passed overall status", () => {
    const state: IProgressReporterState = {
      phases: [
        { name: "pre-scan", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
        { name: "code-agent", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
      ],
      summaryLines: [],
      standardsReview: {
        passed: true,
        issues: [],
        summary: "ok",
        decisions: [],
      },
    };

    assert.equal(computeOverallStatus(state), "passed");
  });

  test("given run history marker this should parse previous runs", () => {
    const body = `<!-- instrument-bot -->\n<!-- instrument-run-history:[{"runId":"1","runUrl":"https://example.com","status":"failed","updatedAt":"t1"}] -->`;
    const history = parseRunHistoryFromComment(body);

    assert.equal(history.length, 1);
    assert.equal(history[0]?.runId, "1");
  });

  test("given new run this should prepend run history", () => {
    const history = appendRunHistory(
      [{ runId: "1", runUrl: "u1", status: "failed", updatedAt: "t1" }],
      { runId: "2", runUrl: "u2", status: "passed", updatedAt: "t2" },
    );

    assert.equal(history[0]?.runId, "2");
    assert.equal(history[1]?.runId, "1");
  });

  test("given run metadata this should render latest run header", () => {
    const body = renderCommentBody({
      phases: [],
      summaryLines: [],
      runMetadata: {
        runId: "99",
        runUrl: "https://github.com/o/r/actions/runs/99",
        runAttempt: "1",
        updatedAt: "2026-07-08T12:00:00.000Z",
        overallStatus: "passed",
      },
    });

    assert.match(body, /Latest run/);
    assert.match(body, /PASSED/);
    assert.match(body, /Workflow #99/);
  });
});
