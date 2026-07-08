import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  formatGhaStepName,
  formatPhaseStepSummary,
  getPhaseDescription,
  PHASE_DESCRIPTIONS,
} from "./phaseDescriptions.js";

describe("packages/orchestrator/src/phaseDescriptions.ts", () => {
  test("given a base pipeline phase this should return its title and subtitle", () => {
    const description = getPhaseDescription("pre-scan");

    assert.equal(description.title, PHASE_DESCRIPTIONS["pre-scan"].title);
    assert.equal(description.subtitle, PHASE_DESCRIPTIONS["pre-scan"].subtitle);
  });

  test("given a sub-phase this should append the suffix to the base subtitle", () => {
    const description = getPhaseDescription("standards-review/attempt-2");

    assert.equal(description.title, "Standards review");
    assert.match(description.subtitle, /attempt 2/);
  });

  test("given an unknown phase this should return a safe fallback description", () => {
    const description = getPhaseDescription("unknown-phase" as "pre-scan");

    assert.equal(description.title, "unknown-phase");
    assert.match(description.subtitle, /Running Instrument pipeline phase/);
  });

  test("given a phase description this should format a GitHub Actions step name", () => {
    const stepName = formatGhaStepName(PHASE_DESCRIPTIONS["code-agent"]);

    assert.equal(
      stepName,
      "Code Agent: Cursor Cloud Agent adds instrumentation and commits to the PR branch.",
    );
  });

  test("given a phase this should format markdown for the GitHub step summary", () => {
    const summary = formatPhaseStepSummary("dashboard-agent");

    assert.match(summary, /^### Dashboard agent\n_/);
    assert.match(summary, /Mixpanel insights/);
  });
});
