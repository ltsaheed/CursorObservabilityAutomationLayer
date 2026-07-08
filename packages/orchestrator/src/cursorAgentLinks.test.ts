import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildCursorCloudAgentUrl,
  formatCursorAgentReference,
  formatCursorCloudAgentLink,
} from "./cursorAgentLinks.js";

describe("packages/orchestrator/src/cursorAgentLinks.ts", () => {
  test("given bc- cloud agent id this should build cursor agents url", () => {
    const agentId = "bc-e39a7c9c-5321-47a5-9440-7783e721d04f";

    assert.equal(
      buildCursorCloudAgentUrl(agentId),
      "https://cursor.com/agents/bc-e39a7c9c-5321-47a5-9440-7783e721d04f",
    );
  });

  test("given legacy bc_ cloud agent id this should build cursor agents url", () => {
    assert.equal(
      buildCursorCloudAgentUrl("bc_abc123"),
      "https://cursor.com/agents/bc_abc123",
    );
  });

  test("given non-cloud agent id this should not build a url", () => {
    assert.equal(buildCursorCloudAgentUrl("agent-abc"), undefined);
  });

  test("given cloud agent id this should format markdown link", () => {
    const link = formatCursorCloudAgentLink(
      "bc-e39a7c9c-5321-47a5-9440-7783e721d04f",
    );

    assert.match(link, /\[.*\]\(https:\/\/cursor\.com\/agents\//);
    assert.match(link, /Open in Cursor/);
  });

  test("given local agent id this should explain no dashboard link", () => {
    const reference = formatCursorAgentReference("local-agent-123", "local");

    assert.match(reference, /local-agent-123/);
    assert.match(reference, /local CI run/);
    assert.doesNotMatch(reference, /cursor\.com\/agents/);
  });
});
