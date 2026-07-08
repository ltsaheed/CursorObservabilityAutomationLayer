import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { formatPhaseDuration, resolvePhaseAgentLabel } from "./phaseUtils.js";
import {
  loadPipelineState,
  mergePipelineState,
  PIPELINE_STATE_DIR,
} from "./pipelineState.js";
import type { IProgressPhaseState } from "./types.js";

describe("packages/orchestrator/src/phaseUtils.ts", () => {
  test("given completed phase this should format duration in seconds", () => {
    const phase: IProgressPhaseState = {
      name: "pre-scan",
      status: "complete",
      startedAt: "2026-07-08T12:00:00.000Z",
      completedAt: "2026-07-08T12:00:03.500Z",
      decisions: [],
      logs: [],
      streamSnippets: [],
    };

    assert.equal(formatPhaseDuration(phase), "4s");
  });

  test("given code agent resume phase this should include agent id label", () => {
    const label = resolvePhaseAgentLabel("code-agent/resume-1", "agent-123");

    assert.match(label, /agent-123/);
  });
});

describe("packages/orchestrator/src/pipelineState.ts", () => {
  test("given saved assessment this should reload pipeline state", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "instrument-state-"));
    mergePipelineState(workspaceRoot, {
      assessment: {
        scannedFiles: ["src/pages/Demo.tsx"],
        gaps: [],
        summary: "No gaps",
      },
    });

    const loaded = loadPipelineState(workspaceRoot);
    const raw = readFileSync(
      join(workspaceRoot, PIPELINE_STATE_DIR, "assessment.json"),
      "utf8",
    );

    assert.equal(loaded.assessment?.summary, "No gaps");
    assert.match(raw, /No gaps/);
  });
});
