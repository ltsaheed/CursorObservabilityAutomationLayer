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
    assert.match(description.subtitle, /Review attempt 2/);
    assert.match(description.subtitle, /analytics standards/);
  });

  test("given a code agent resume sub-phase this should describe the fix round", () => {
    const description = getPhaseDescription("code-agent/resume-1");

    assert.equal(description.title, "Code Agent fix");
    assert.match(description.subtitle, /Fix round 1/);
    assert.match(description.subtitle, /Review Agent feedback/);
  });

  test("given an unknown phase this should return a safe fallback description", () => {
    const description = getPhaseDescription("unknown-phase" as "pre-scan");

    assert.equal(description.title, "unknown-phase");
    assert.match(description.subtitle, /Running Instrument pipeline phase/);
  });

  test("given a phase description this should format a GitHub Actions step name", () => {
    const stepName = formatGhaStepName(PHASE_DESCRIPTIONS["standards-review"]);

    assert.match(stepName, /^Standards review:/);
    assert.match(stepName, /separate Review Agent/);
    assert.match(stepName, /up to 2 fix rounds/);
  });

  test("given a phase this should format markdown for the GitHub step summary", () => {
    const summary = formatPhaseStepSummary("dashboard-agent");

    assert.match(summary, /^### Dashboard agent\n_/);
    assert.match(summary, /Mixpanel insights/);
  });
});
