import { appendFileSync } from "node:fs";

import * as core from "@actions/core";

import type {
  ICoverageAssessment,
  IDashboardPlan,
  IInstrumentReport,
  IStandardsReviewResult,
  IProgressPhase,
  IProgressPhaseState,
  IProgressReporter,
  IProgressReporterState,
} from "./types.js";
import { deployResultSchema } from "./types.js";
import type { z } from "zod";

const MAX_STREAM_SNIPPETS = 8;
const MAX_STREAM_SNIPPET_LENGTH = 240;

const isGitHubActions = (): boolean => process.env.GITHUB_ACTIONS === "true";

const nowIso = (): string => new Date().toISOString();

const getPhaseState = (
  state: IProgressReporterState,
  phase: IProgressPhase,
): IProgressPhaseState => {
  const existing = state.phases.find((entry) => entry.name === phase);

  if (existing) {
    return existing;
  }

  const created: IProgressPhaseState = {
    name: phase,
    status: "running",
    startedAt: nowIso(),
    decisions: [],
    logs: [],
    streamSnippets: [],
  };

  state.phases.push(created);

  return created;
};

const extractTextFromEvent = (event: unknown): string | null => {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;

  if (record.type === "assistant" && record.message && typeof record.message === "object") {
    const message = record.message as { content?: Array<{ type?: string; text?: string }> };

    const text = message.content
      ?.filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("");

    return text?.trim() || null;
  }

  if (typeof record.text === "string") {
    return record.text.trim();
  }

  if (typeof record.message === "string") {
    return record.message.trim();
  }

  return null;
};

const truncateSnippet = (text: string): string => {
  if (text.length <= MAX_STREAM_SNIPPET_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_STREAM_SNIPPET_LENGTH - 3)}...`;
};

const writeStepSummary = (line: string): void => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryPath) {
    return;
  }

  appendFileSync(summaryPath, `${line}\n`, "utf8");
};

export const createProgressReporter = (): IProgressReporter => {
  const state: IProgressReporterState = {
    phases: [],
    summaryLines: [],
  };

  const emit = (message: string): void => {
    if (isGitHubActions()) {
      core.info(message);
      return;
    }

    console.log(message);
  };

  return {
    phaseStart: (phase) => {
      const phaseState = getPhaseState(state, phase);
      phaseState.status = "running";
      phaseState.startedAt = nowIso();
      emit(`[instrument] phase start: ${phase}`);
      writeStepSummary(`### ${phase}\n`);
    },

    decision: (phase, label, detail) => {
      const phaseState = getPhaseState(state, phase);
      phaseState.decisions.push({ label, detail });
      emit(`[instrument] ${phase} decision: ${label} - ${detail}`);
      writeStepSummary(`- **${label}**: ${detail}`);
    },

    log: (phase, message, level = "info") => {
      const phaseState = getPhaseState(state, phase);
      phaseState.logs.push({
        level,
        message,
        timestamp: nowIso(),
      });

      if (isGitHubActions()) {
        if (level === "error") {
          core.error(`[${phase}] ${message}`);
        } else if (level === "warn") {
          core.warning(`[${phase}] ${message}`);
        } else {
          core.info(`[${phase}] ${message}`);
        }
      } else if (level === "error") {
        console.error(`[${phase}] ${message}`);
      } else if (level === "warn") {
        console.warn(`[${phase}] ${message}`);
      } else {
        console.log(`[${phase}] ${message}`);
      }
    },

    streamEvent: (phase, event) => {
      const text = extractTextFromEvent(event);

      if (!text) {
        return;
      }

      const phaseState = getPhaseState(state, phase);
      const snippet = truncateSnippet(text);
      phaseState.streamSnippets.push({
        text: snippet,
        timestamp: nowIso(),
      });

      if (phaseState.streamSnippets.length > MAX_STREAM_SNIPPETS) {
        phaseState.streamSnippets.shift();
      }
    },

    phaseComplete: (phase, status = "complete") => {
      const phaseState = getPhaseState(state, phase);
      phaseState.status = status;
      phaseState.completedAt = nowIso();
      emit(`[instrument] phase ${status}: ${phase}`);
      writeStepSummary(`\n`);
    },

    setAssessment: (assessment: ICoverageAssessment) => {
      state.assessment = assessment;
    },

    setReport: (report: IInstrumentReport) => {
      state.report = report;
    },

    setStandardsReview: (review: IStandardsReviewResult) => {
      state.standardsReview = review;
    },

    setDashboardPlan: (plan: IDashboardPlan) => {
      state.dashboardPlan = plan;
    },

    setDeployResult: (result: z.infer<typeof deployResultSchema>) => {
      state.deployResult = result;
    },

    appendSummaryLine: (line: string) => {
      state.summaryLines.push(line);
      writeStepSummary(line);
    },

    getState: () => state,

    finalize: async () => {
      emit("[instrument] pipeline complete");
      writeStepSummary("\n---\n_Instrument pipeline finished._\n");
    },
  };
};
