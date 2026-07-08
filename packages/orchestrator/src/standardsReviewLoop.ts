import { Agent, CursorAgentError } from "@cursor/sdk";

import { runReviewAgent } from "./reviewAgent.js";
import { loadInstrumentReport, REPORT_RELATIVE_PATH } from "./reportLoader.js";
import type { IGitHubCommentContext } from "./github.js";
import type {
  ICoverageAssessment,
  IInstrumentReport,
  IProgressReporter,
  IStandardsReviewResult,
} from "./types.js";
import { standardsReviewResultSchema } from "./types.js";

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
  github?: IGitHubCommentContext;
}

export const MAX_REVIEW_RETRIES = 2;

export const buildFixPrompt = (issues: IStandardsReviewResult["issues"]): string => {
  return `The Review Agent found standards violations. Fix every issue, re-run tests, update ${REPORT_RELATIVE_PATH}, commit and push.\n\n${JSON.stringify(issues, null, 2)}\n\nFollow ADR-031 in .cursor/rules/analytics-standards.mdc.`;
};

const resumeCodeAgentFix = async (
  codeAgentId: string,
  issues: IStandardsReviewResult["issues"],
  attempt: number,
  reporter: IProgressReporter,
): Promise<void> => {
  const apiKey = process.env.CURSOR_API_KEY;
  const resumePhase = `code-agent/resume-${attempt + 1}` as const;
  const fixPrompt = buildFixPrompt(issues);

  if (!apiKey) {
    throw new Error("CURSOR_API_KEY required to resume code agent");
  }

  reporter.phaseStart(resumePhase);
  reporter.decision(resumePhase, "Resume target", `\`${codeAgentId}\``);
  reporter.decision(
    resumePhase,
    "Fix prompt",
    fixPrompt.length > 500 ? `${fixPrompt.slice(0, 497)}...` : fixPrompt,
  );
  reporter.log(resumePhase, `Resuming code agent ${codeAgentId} to fix issues`);

  try {
    await using agent = await Agent.resume(codeAgentId, { apiKey });
    const run = await agent.send(fixPrompt);
    reporter.log(resumePhase, `Started fix run ${run.id}`);

    for await (const event of run.stream()) {
      reporter.streamEvent(resumePhase, event);
    }

    const result = await run.wait();

    if (result.status === "error") {
      reporter.phaseComplete(resumePhase, "failed");
      throw new Error(`Code agent fix run failed: ${result.id}`);
    }

    reporter.phaseComplete(resumePhase, "complete");
  } catch (error) {
    reporter.phaseComplete(resumePhase, "failed");
    throw error;
  }
};

export const runStandardsReviewLoop = async (
  options: IStandardsReviewLoopOptions,
): Promise<{ report: IInstrumentReport; review: IStandardsReviewResult }> => {
  const { reporter, dryRun, workspaceRoot, assessment, codeAgentId, github } = options;
  let currentReport = options.report;

  reporter.phaseStart("standards-review");

  for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
    const attemptPhase = `standards-review/attempt-${attempt + 1}` as const;
    const simulateFail = dryRun && attempt === 0;

    reporter.phaseStart(attemptPhase);
    reporter.decision(
      attemptPhase,
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
      phase: attemptPhase,
    });

    if (review.passed) {
      reporter.decision(attemptPhase, "Result", review.summary);
      reporter.phaseComplete(attemptPhase, "complete");
      reporter.decision("standards-review", "Passed", review.summary);
      reporter.phaseComplete("standards-review", "complete");
      reporter.appendSummaryLine(
        "Standards review: PASSED — awaiting human reviewer approval.",
      );

      return { report: currentReport, review };
    }

    reporter.decision(
      attemptPhase,
      "Result",
      `${review.issues.length} issue(s): ${review.summary}`,
    );
    reporter.phaseComplete(attemptPhase, "failed");

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
      `${review.issues.length} issue(s) — resuming Code Agent (attempt ${attempt + 1})`,
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
      await resumeCodeAgentFix(codeAgentId, review.issues, attempt, reporter);
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

    const refreshed = await loadInstrumentReport({ workspaceRoot, github });

    if (refreshed.report) {
      currentReport = refreshed.report;
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
