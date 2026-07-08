const CLOUD_AGENT_ID_PATTERN = /^bc[-_]/i;

export const buildCursorCloudAgentUrl = (agentId: string): string | undefined => {
  const trimmed = agentId.trim();

  if (!trimmed || !CLOUD_AGENT_ID_PATTERN.test(trimmed)) {
    return undefined;
  }

  return `https://cursor.com/agents/${encodeURIComponent(trimmed)}`;
};

export type ICursorAgentRuntime = "cloud" | "local";

export const inferCursorAgentRuntime = (agentId: string): ICursorAgentRuntime => {
  return CLOUD_AGENT_ID_PATTERN.test(agentId.trim()) ? "cloud" : "local";
};

export const formatCursorCloudAgentLink = (
  agentId: string,
  label = "Open in Cursor",
): string => {
  const url = buildCursorCloudAgentUrl(agentId);

  if (!url) {
    return `\`${agentId}\``;
  }

  return `[\`${agentId}\`](${url}) (${label})`;
};

export const formatCursorAgentReference = (
  agentId: string,
  runtime: ICursorAgentRuntime = inferCursorAgentRuntime(agentId),
): string => {
  if (runtime === "cloud") {
    return formatCursorCloudAgentLink(agentId);
  }

  return `\`${agentId}\` (local CI run — no web dashboard link)`;
};
