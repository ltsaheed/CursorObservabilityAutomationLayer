import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@cursor/sdk";

import {
  formatPrioritizationReason,
  rankNewEventsForReporting,
  selectPrioritizedEvents,
} from "./eventPrioritization.js";
import type { IDashboardPlan, IInstrumentReport, IProgressReporter, IReportPlan } from "./types.js";
import { dashboardPlanSchema } from "./types.js";

export const MAX_REPORTS_PER_PR = 2;

export interface IDashboardAgentOptions {
  dryRun: boolean;
  reporter: IProgressReporter;
}

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "dashboardAgent.md",
);

const toTitleCase = (eventName: string): string => {
  return eventName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const scoreReportPlan = (
  reportPlan: IReportPlan,
  rankedEvents: ReturnType<typeof rankNewEventsForReporting>,
): number => {
  const rankByEvent = new Map(rankedEvents.map((entry) => [entry.eventName, entry.score]));

  if (reportPlan.type === "insights") {
    return rankByEvent.get(reportPlan.event) ?? 0;
  }

  const stepScores = reportPlan.steps.map((step) => rankByEvent.get(step) ?? 0);

  return stepScores.reduce((sum, score) => sum + score, 0) / stepScores.length;
};

export const capDashboardPlanReports = (
  plan: IDashboardPlan,
  report?: IInstrumentReport,
): IDashboardPlan => {
  if (plan.reports.length <= MAX_REPORTS_PER_PR) {
    return plan;
  }

  const rankedEvents = report ? rankNewEventsForReporting(report) : [];
  const reportsToKeep =
    report && rankedEvents.length > 0
      ? [...plan.reports]
          .sort(
            (left, right) =>
              scoreReportPlan(right, rankedEvents) - scoreReportPlan(left, rankedEvents),
          )
          .slice(0, MAX_REPORTS_PER_PR)
      : plan.reports.slice(0, MAX_REPORTS_PER_PR);

  const droppedCount = plan.reports.length - reportsToKeep.length;
  const prioritizationReason = report
    ? formatPrioritizationReason(
        reportsToKeep
          .flatMap((entry) => (entry.type === "insights" ? [entry.event] : entry.steps))
          .filter((eventName, index, events) => events.indexOf(eventName) === index)
          .slice(0, MAX_REPORTS_PER_PR),
        rankedEvents,
      )
    : `Kept the first ${MAX_REPORTS_PER_PR} planned report(s).`;

  return dashboardPlanSchema.parse({
    decisions: [
      ...plan.decisions,
      {
        summary: `Prioritized ${MAX_REPORTS_PER_PR} of ${plan.reports.length} planned dashboard reports`,
        reason: `Instrument limits Mixpanel additions to ${MAX_REPORTS_PER_PR} per PR. Dropped ${droppedCount} lower-priority report(s). ${prioritizationReason}`,
      },
    ],
    reports: reportsToKeep,
  });
};

const finalizeDashboardPlan = (
  plan: IDashboardPlan,
  report?: IInstrumentReport,
): IDashboardPlan => {
  return capDashboardPlanReports(dashboardPlanSchema.parse(plan), report);
};

const buildInsightsReport = (
  eventName: string,
  rankedEvents: ReturnType<typeof rankNewEventsForReporting>,
): IDashboardPlan["reports"][number] => {
  const rank = rankedEvents.find((entry) => entry.eventName === eventName);
  const reasonSuffix = rank ? rank.reasons.join("; ") : "Added in this PR";

  if (eventName.endsWith("_viewed")) {
    return {
      type: "insights",
      name: `${toTitleCase(eventName)} Trend`,
      description: `Daily trend for ${eventName}`,
      event: eventName,
      reason: `Prioritized page view event: ${reasonSuffix}`,
    };
  }

  return {
    type: "insights",
    name: `${toTitleCase(eventName)} Trend`,
    description: `Daily trend for ${eventName}`,
    event: eventName,
    reason: `Prioritized user action event: ${reasonSuffix}`,
  };
};

export const buildDashboardPlanDeterministic = (
  report: IInstrumentReport,
): IDashboardPlan => {
  const allEvents = report.newEvents;

  if (allEvents.length === 0) {
    return finalizeDashboardPlan(
      {
        decisions: [
          {
            summary: "No dashboard reports for this PR",
            reason:
              "newEvents is empty; skip Mixpanel deploy until instrumentation adds new events.",
          },
        ],
        reports: [],
      },
      report,
    );
  }

  const { events: focusEvents, ranked } = selectPrioritizedEvents(report, MAX_REPORTS_PER_PR);
  const decisions = [
    {
      summary: "Deterministic dashboard planning",
      reason: "Generated without AI using prioritized new events from the instrumentation report.",
    },
  ];

  if (allEvents.length > MAX_REPORTS_PER_PR) {
    decisions.push({
      summary: `Prioritized ${MAX_REPORTS_PER_PR} of ${allEvents.length} new events for dashboard reports`,
      reason: formatPrioritizationReason(focusEvents, ranked),
    });
  }

  const reports = focusEvents.map((eventName) => buildInsightsReport(eventName, ranked));

  return finalizeDashboardPlan(
    {
      decisions,
      reports,
    },
    report,
  );
};

const loadPrompt = (): string => readFileSync(PROMPT_PATH, "utf8");

const extractDashboardPlan = (text: string): IDashboardPlan | null => {
  const jsonMatch = text.match(/\{[\s\S]*"reports"\s*:\s*\[[\s\S]*\]\s*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;

    return dashboardPlanSchema.parse(parsed);
  } catch {
    return null;
  }
};

export const runDashboardAgent = async (
  report: IInstrumentReport,
  options: IDashboardAgentOptions,
): Promise<IDashboardPlan> => {
  const { dryRun, reporter } = options;

  reporter.phaseStart("dashboard-agent");

  if (dryRun || !process.env.CURSOR_API_KEY) {
    const reason = dryRun ? "dry-run mode" : "CURSOR_API_KEY not set";
    reporter.decision(
      "dashboard-agent",
      "Deterministic fallback",
      `Using rule-based planner (${reason})`,
    );
    const plan = buildDashboardPlanDeterministic(report);
    reporter.setDashboardPlan(plan);
    reporter.phaseComplete("dashboard-agent", "complete");

    return plan;
  }

  const ranked = rankNewEventsForReporting(report);
  const prioritizationHint =
    report.newEvents.length > MAX_REPORTS_PER_PR
      ? `\n\n## Event prioritization hint\n\nInstrument allows at most ${MAX_REPORTS_PER_PR} dashboard reports per PR. When choosing reports, prioritize events in this order and explain your choice in \`decisions\`:\n${ranked
          .map(
            (entry, index) =>
              `${index + 1}. ${entry.eventName} (score ${entry.score}: ${entry.reasons.join("; ")})`,
          )
          .join("\n")}`
      : "";

  const prompt = `${loadPrompt()}${prioritizationHint}\n\n## Instrumentation report\n\n${JSON.stringify(report, null, 2)}\n\nReturn only valid JSON matching the dashboard plan schema.`;

  try {
    const result = await Agent.prompt(prompt, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      cloud: {},
    });

    const parsed = result.result ? extractDashboardPlan(result.result) : null;

    if (parsed) {
      const plan = finalizeDashboardPlan(parsed, report);
      reporter.decision("dashboard-agent", "AI plan", "Dashboard plan generated by agent");
      reporter.setDashboardPlan(plan);
      reporter.phaseComplete("dashboard-agent", "complete");

      return plan;
    }

    reporter.decision(
      "dashboard-agent",
      "Fallback",
      "Agent response could not be parsed; using deterministic planner",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard agent failed";
    reporter.log("dashboard-agent", message, "warn");
    reporter.decision(
      "dashboard-agent",
      "Fallback",
      "Agent call failed; using deterministic planner",
    );
  }

  const fallbackPlan = buildDashboardPlanDeterministic(report);
  reporter.setDashboardPlan(fallbackPlan);
  reporter.phaseComplete("dashboard-agent", "complete");

  return fallbackPlan;
};
