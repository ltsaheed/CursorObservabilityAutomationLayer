import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@cursor/sdk";

import type {
  ICoverageAssessment,
  IInstrumentReport,
  IProgressReporter,
  IProgressSubPhase,
  IStandardsReviewResult,
} from "./types.js";
import { standardsReviewResultSchema } from "./types.js";

export interface IReviewAgentOptions {
  workspaceRoot: string;
  assessment: ICoverageAssessment;
  report: IInstrumentReport;
  dryRun: boolean;
  reporter: IProgressReporter;
  simulateFail?: boolean;
  phase?: IProgressSubPhase;
}

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "reviewAgent.md",
);

const loadPrompt = (): string => readFileSync(PROMPT_PATH, "utf8");

const extractJsonFromText = (text: string): IStandardsReviewResult | null => {
  const jsonMatch = text.match(/\{[\s\S]*"passed"\s*:[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return standardsReviewResultSchema.parse(JSON.parse(jsonMatch[0]));
  } catch {
    return null;
  }
};

const buildDryRunReview = (
  report: IInstrumentReport,
  simulateFail: boolean,
): IStandardsReviewResult => {
  if (simulateFail) {
    const targetFile = report.filesChanged[0] ?? "src/pages/CheckoutRetryPage.tsx";

    return standardsReviewResultSchema.parse({
      passed: false,
      issues: [
        {
          severity: "error",
          file: targetFile,
          line: 1,
          rule: "ADR-031-page-view",
          message: "Missing checkout_retry_viewed event on mount",
          suggestion:
            "Add useEffect with track('checkout_retry_viewed', { page: 'checkout_retry' })",
        },
      ],
      summary: "Review failed: missing required page view event.",
      decisions: [
        {
          summary: "Page view check",
          reason: "New page must emit {page}_viewed on mount per ADR-031",
        },
      ],
    });
  }

  return standardsReviewResultSchema.parse({
    passed: true,
    issues: [],
    summary: "All instrumentation meets ADR-031.",
    decisions: [
      {
        summary: "Wrapper usage",
        reason: "Mock review confirms track() via analytics wrapper",
      },
      {
        summary: "Event naming",
        reason: `Validated events: ${report.newEvents.join(", ")}`,
      },
    ],
  });
};

export const runReviewAgent = async (
  options: IReviewAgentOptions,
): Promise<IStandardsReviewResult> => {
  const { reporter, dryRun, report, assessment, workspaceRoot, simulateFail, phase = "standards-review" } = options;

  if (dryRun || !process.env.CURSOR_API_KEY) {
    const reason = dryRun ? "dry-run mode" : "CURSOR_API_KEY not set";
    reporter.decision(phase, "Dry run", `Mock review agent (${reason})`);
    const result = buildDryRunReview(report, simulateFail ?? false);
    reporter.decision(
      phase,
      result.passed ? "Passed" : "Failed",
      result.summary,
    );

    return result;
  }

  const fileBlocks = report.filesChanged
    .map((file) => {
      try {
        const content = readFileSync(join(workspaceRoot, file), "utf8");

        return `### ${file}\n\`\`\`tsx\n${content}\n\`\`\``;
      } catch {
        return `### ${file}\n(file not found in workspace checkout)`;
      }
    })
    .join("\n\n");

  const prompt = `${loadPrompt()}\n\n## Assessment\n${JSON.stringify(assessment, null, 2)}\n\n## Report\n${JSON.stringify(report, null, 2)}\n\n## Files\n${fileBlocks}`;

  const result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: "composer-2.5" },
    local: { cwd: workspaceRoot },
  });

  if (result.status === "error" || !result.result) {
    reporter.log(phase, "Review agent run failed", "error");

    return standardsReviewResultSchema.parse({
      passed: false,
      issues: [],
      summary: "Review agent failed to produce a result.",
      decisions: [],
    });
  }

  return (
    extractJsonFromText(result.result) ??
    standardsReviewResultSchema.parse({
      passed: false,
      issues: [],
      summary: "Review agent returned invalid JSON.",
      decisions: [],
    })
  );
};
