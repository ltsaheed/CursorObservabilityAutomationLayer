import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ICoverageAssessment,
  IDashboardPlan,
  IInstrumentReport,
  IProgressReporterState,
  IRunOptions,
  IStandardsReviewResult,
} from "./types.js";
import {
  coverageAssessmentSchema,
  dashboardPlanSchema,
  deployResultSchema,
  instrumentReportSchema,
  standardsReviewResultSchema,
} from "./types.js";
import type { z } from "zod";

export const PIPELINE_STATE_DIR = ".instrument/state";

export interface IPipelineState {
  assessment?: ICoverageAssessment;
  report?: IInstrumentReport;
  codeAgentId?: string;
  standardsReview?: IStandardsReviewResult;
  dashboardPlan?: IDashboardPlan;
  deployResult?: z.infer<typeof deployResultSchema>;
  progress?: IProgressReporterState;
}

export const getPipelineStateDir = (workspaceRoot: string): string =>
  join(workspaceRoot, PIPELINE_STATE_DIR);

const readJsonFile = <T>(path: string, parse: (value: unknown) => T): T | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;

    return parse(raw);
  } catch {
    return undefined;
  }
};

const writeJsonFile = (dir: string, filename: string, value: unknown): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const loadPipelineState = (workspaceRoot: string): IPipelineState => {
  const dir = getPipelineStateDir(workspaceRoot);

  return {
    assessment: readJsonFile(join(dir, "assessment.json"), (value) =>
      coverageAssessmentSchema.parse(value),
    ),
    report: readJsonFile(join(dir, "report.json"), (value) =>
      instrumentReportSchema.parse(value),
    ),
    codeAgentId: readJsonFile(join(dir, "code-agent-meta.json"), (value) => {
      if (!value || typeof value !== "object") {
        return undefined;
      }

      const record = value as { agentId?: string };

      return typeof record.agentId === "string" ? record.agentId : undefined;
    }),
    standardsReview: readJsonFile(join(dir, "standards-review.json"), (value) =>
      standardsReviewResultSchema.parse(value),
    ),
    dashboardPlan: readJsonFile(join(dir, "dashboard-plan.json"), (value) =>
      dashboardPlanSchema.parse(value),
    ),
    deployResult: readJsonFile(join(dir, "deploy-result.json"), (value) =>
      deployResultSchema.parse(value),
    ),
    progress: readJsonFile(join(dir, "progress.json"), (value) => value as IProgressReporterState),
  };
};

export const savePipelineState = (
  workspaceRoot: string,
  state: IPipelineState,
): void => {
  const dir = getPipelineStateDir(workspaceRoot);

  if (state.assessment) {
    writeJsonFile(dir, "assessment.json", state.assessment);
  }

  if (state.report) {
    writeJsonFile(dir, "report.json", state.report);
  }

  if (state.codeAgentId) {
    writeJsonFile(dir, "code-agent-meta.json", { agentId: state.codeAgentId });
  }

  if (state.standardsReview) {
    writeJsonFile(dir, "standards-review.json", state.standardsReview);
  }

  if (state.dashboardPlan) {
    writeJsonFile(dir, "dashboard-plan.json", state.dashboardPlan);
  }

  if (state.deployResult) {
    writeJsonFile(dir, "deploy-result.json", state.deployResult);
  }

  if (state.progress) {
    writeJsonFile(dir, "progress.json", state.progress);
  }
};

export const mergePipelineState = (
  workspaceRoot: string,
  patch: Partial<IPipelineState>,
): IPipelineState => {
  const current = loadPipelineState(workspaceRoot);
  const merged = { ...current, ...patch };

  savePipelineState(workspaceRoot, merged);

  return merged;
};

export const persistReporterState = (
  workspaceRoot: string,
  reporter: { getState: () => IProgressReporterState },
  patch: Partial<IPipelineState> = {},
): void => {
  mergePipelineState(workspaceRoot, {
    ...patch,
    progress: reporter.getState(),
  });
};

export const saveRunOptionsSnapshot = (
  workspaceRoot: string,
  options: IRunOptions,
): void => {
  writeJsonFile(getPipelineStateDir(workspaceRoot), "run-options.json", options);
};
