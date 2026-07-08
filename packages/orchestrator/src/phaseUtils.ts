import type { IProgressPhaseState } from "./types.js";

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
  codeAgentId?: string,
): string => {
  if (phaseName.startsWith("code-agent/resume-") && codeAgentId) {
    return `resumed \`${codeAgentId}\``;
  }

  if (phaseName === "code-agent" && codeAgentId) {
    return `\`${codeAgentId}\``;
  }

  return "—";
};
