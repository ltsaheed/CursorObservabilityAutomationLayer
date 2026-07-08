import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Agent, CursorAgentError } from "@cursor/sdk";

import { runReviewAgent } from "./reviewAgent.js";
import type {
  ICoverageAssessment,
  IInstrumentReport,
  IProgressReporter,
  IStandardsReviewResult,
} from "./types.js";
import { instrumentReportSchema, standardsReviewResultSchema } from "./types.js";

export class StandardsReviewError extends Error {
  public readonly issues: IStandardsReviewResult["issues"];

  constructor(review: IStandardsReviewResult) {
    super(review.summary);
    this.name = "StandardsReviewError";
    this.issues = review.issues;
  }
}

export interface IStandardsReviewLoopOptions {
  workspaceRoot: string;
  assessment: ICoverageAssessment;
  report: IInstrumentReport;
  codeAgentId?: string;
  dryRun: boolean;
  reporter: IProgressReporter;
}

const MAX_REVIEW_RETRIES = 2;
const REPORT_PATH = ".instrument/report.json";

const readReport = (workspaceRoot: string): IInstrumentReport | null => {
  try {
    const raw = readFileSync(join(workspaceRoot, REPORT_PATH), "utf8");

    return instrumentReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

const buildFixPrompt = (issues: IStandardsReviewResult["issues"]): string => {
  return `The Review Agent found standards violations. Fix every issue, re-run tests, update ${REPORT_PATH}.\n\n${JSON.stringify(issues, null, 2)}\n\nFollow ADR-031 in .cursor/rules/analytics-standards.mdc.`;
};

const resumeCodeAgentFix = async (
  codeAgentId: string,
  issues: IStandardsReviewResult["issues"],
  reporter: IProgressReporter,
): Promise<void> => {
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    throw new Error("CURSOR_API_KEY required to resume code agent");
  }

  reporter.log("standards-review", `Resuming code agent ${codeAgentId} to fix issues`);

  await using agent = await Agent.resume(codeAgentId, { apiKey });
  const run = await agent.send(buildFixPrompt(issues));

  for await (const event of run.stream()) {
    reporter.streamEvent("standards-review", event);
  }

  const result = await run.wait();

  if (result.status === "error") {
    throw new Error(`Code agent fix run failed: ${result.id}`);
  }
};

export const runStandardsReviewLoop = async (
  options: IStandardsReviewLoopOptions,
): Promise<{ report: IInstrumentReport; review: IStandardsReviewResult }> => {
  const { reporter, dryRun, workspaceRoot, assessment, codeAgentId } = options;
  let currentReport = options.report;

  reporter.phaseStart("standards-review");

  for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
    const simulateFail = dryRun && attempt === 0;

    reporter.decision(
      "standards-review",
      "Review attempt",
      `${attempt + 1} of ${MAX_REVIEW_RETRIES + 1}`,
    );

    const review = await runReviewAgent({
      workspaceRoot,
      assessment,
      report: currentReport,
      dryRun,
      reporter,
      simulateFail,
    });

    if (review.passed) {
      reporter.decision("standards-review", "Passed", review.summary);
      reporter.phaseComplete("standards-review", "complete");
      reporter.appendSummaryLine(
        "Standards review: PASSED — awaiting human reviewer approval.",
      );

      return { report: currentReport, review };
    }

    if (attempt === MAX_REVIEW_RETRIES) {
      reporter.decision("standards-review", "Failed", review.summary);
      reporter.phaseComplete("standards-review", "failed");
      reporter.appendSummaryLine(
        `Standards review: FAILED after ${MAX_REVIEW_RETRIES + 1} attempts.`,
      );
      throw new StandardsReviewError(review);
    }

    reporter.decision(
      "standards-review",
      "Fix required",
      `${review.issues.length} issue(s) — resuming Code Agent`,
    );

    if (dryRun) {
      reporter.log(
        "standards-review",
        `Dry-run: simulating Code Agent fix (attempt ${attempt + 1})`,
      );
      continue;
    }

    if (!codeAgentId) {
      reporter.phaseComplete("standards-review", "failed");
      throw new StandardsReviewError(review);
    }

    try {
      await resumeCodeAgentFix(codeAgentId, review.issues, reporter);
    } catch (error) {
      const message = error instanceof CursorAgentError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Resume failed";
      reporter.log("standards-review", message, "error");
      reporter.phaseComplete("standards-review", "failed");
      throw error;
    }

    const refreshed = readReport(workspaceRoot);

    if (refreshed) {
      currentReport = refreshed;
      reporter.setReport(currentReport);
    }
  }

  throw new StandardsReviewError(
    standardsReviewResultSchema.parse({
      passed: false,
      issues: [],
      summary: "Unexpected standards review loop exit",
      decisions: [],
    }),
  );
};
