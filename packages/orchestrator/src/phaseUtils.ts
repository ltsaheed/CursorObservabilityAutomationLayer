import type { IProgressPhaseState } from "./types.js";
import {
  formatCursorAgentReference,
  formatCursorCloudAgentLink,
} from "./cursorAgentLinks.js";

export const formatPhaseDuration = (phase: IProgressPhaseState): string => {
  if (!phase.completedAt) {
    return "running";
  }

  const durationMs =
    new Date(phase.completedAt).getTime() - new Date(phase.startedAt).getTime();

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.round(durationMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds}s`;
};

export const resolvePhaseAgentLabel = (
  phaseName: string,
  phases: IProgressPhaseState[],
  codeAgentId?: string,
): string => {
  const phase = phases.find((entry) => entry.name === phaseName);

  if (phase?.cursorAgentId) {
    return formatCursorAgentReference(
      phase.cursorAgentId,
      phase.cursorAgentRuntime ?? "cloud",
    );
  }

  if (phaseName.startsWith("code-agent/resume-") && codeAgentId) {
    return `resumed ${formatCursorCloudAgentLink(codeAgentId)}`;
  }

  if (phaseName === "code-agent" && codeAgentId) {
    return formatCursorCloudAgentLink(codeAgentId);
  }

  if (phaseName === "mixpanel-deploy") {
    return "Mixpanel API";
  }

  return "—";
};
