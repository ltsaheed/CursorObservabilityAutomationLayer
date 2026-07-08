import type {
  IDashboardPlan,
  IInstrumentEvent,
  IInstrumentReport,
  IReportPlan,
} from "./types.js";

export const MAX_DASHBOARD_REPORTS_PER_PR = 2;

export const BOARD_REPORT_DESTINATION_LABEL = "Board report";
export const EVENTS_ONLY_DESTINATION_LABEL = "Events only";

export interface IDashboardEventCoverage {
  withDashboardReport: string[];
  trackedOnly: string[];
}

export const findPlannedReportForEvent = (
  eventName: string,
  plan?: IDashboardPlan,
): IReportPlan | undefined => {
  return plan?.reports.find((report) => {
    if (report.type === "insights") {
      return report.event === eventName;
    }

    return report.steps.includes(eventName);
  });
};

export const isEventOnDashboardPlan = (
  eventName: string,
  plan?: IDashboardPlan,
): boolean => {
  return findPlannedReportForEvent(eventName, plan) !== undefined;
};

export const collectEventsFromDashboardPlan = (plan?: IDashboardPlan): string[] => {
  if (!plan) {
    return [];
  }

  const events = new Set<string>();

  for (const report of plan.reports) {
    if (report.type === "insights") {
      events.add(report.event);
    } else {
      for (const step of report.steps) {
        events.add(step);
      }
    }
  }

  return [...events];
};

export const splitNewEventsByDashboardCoverage = (
  newEvents: string[],
  dashboardPlan?: IDashboardPlan,
): IDashboardEventCoverage => {
  const covered = new Set(collectEventsFromDashboardPlan(dashboardPlan));

  return {
    withDashboardReport: newEvents.filter((eventName) => covered.has(eventName)),
    trackedOnly: newEvents.filter((eventName) => !covered.has(eventName)),
  };
};

export interface IEventPriorityRank {
  eventName: string;
  score: number;
  reasons: string[];
}

const HIGH_INTENT_SUFFIXES = [
  "_submitted",
  "_completed",
  "_purchased",
  "_converted",
  "_submit_clicked",
];
const PRODUCT_SIGNAL_PATTERN =
  /conversion|funnel|drop.?off|revenue|payment|checkout|purchase|submit|retention|abandon/i;

const findEventInReport = (
  report: IInstrumentReport,
  eventName: string,
): IInstrumentEvent | undefined => {
  for (const page of report.pages) {
    const event = page.events.find((entry) => entry.name === eventName);

    if (event) {
      return event;
    }
  }

  return undefined;
};

const getPrimaryPageName = (report: IInstrumentReport): string | undefined => {
  if (report.pages.length === 0) {
    return undefined;
  }

  const newEventNames = new Set(report.newEvents);
  let bestPage = report.pages[0];
  let bestCount = 0;

  for (const page of report.pages) {
    const count = page.events.filter((event) => newEventNames.has(event.name)).length;

    if (count > bestCount) {
      bestCount = count;
      bestPage = page;
    }
  }

  return bestPage.name;
};

export const scoreEventForReporting = (
  eventName: string,
  report: IInstrumentReport,
  primaryPageName?: string,
): IEventPriorityRank => {
  const reasons: string[] = [];
  let score = 0;
  const eventMeta = findEventInReport(report, eventName);
  const changeBlock = report.changeBlocks.find((block) => block.events.includes(eventName));
  const visibilityText = [
    eventMeta?.visibility,
    eventMeta?.justification,
    changeBlock?.visibility,
    changeBlock?.justification,
  ]
    .filter(Boolean)
    .join(" ");

  if (eventName.endsWith("_viewed")) {
    score += 100;
    reasons.push("page view establishes funnel entry volume");
  } else if (HIGH_INTENT_SUFFIXES.some((suffix) => eventName.endsWith(suffix))) {
    score += 85;
    reasons.push("high-intent action event");
  } else if (eventName.endsWith("_clicked")) {
    score += 65;
    reasons.push("user interaction click event");
  } else {
    score += 40;
    reasons.push("tracked user action");
  }

  if (PRODUCT_SIGNAL_PATTERN.test(visibilityText)) {
    score += 20;
    reasons.push("visibility text signals core product metric");
  }

  if (changeBlock?.visibility?.trim()) {
    score += 10;
    reasons.push("called out in a PR change block");
  }

  if (primaryPageName && eventMeta) {
    const page = report.pages.find((entry) =>
      entry.events.some((event) => event.name === eventName),
    );

    if (page?.name === primaryPageName) {
      score += 15;
      reasons.push("event on the PR's primary instrumented page");
    }
  }

  return { eventName, score, reasons };
};

export const rankNewEventsForReporting = (
  report: IInstrumentReport,
): IEventPriorityRank[] => {
  const primaryPageName = getPrimaryPageName(report);

  return report.newEvents
    .map((eventName) => scoreEventForReporting(eventName, report, primaryPageName))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.eventName.localeCompare(right.eventName);
    });
};

export const selectPrioritizedEvents = (
  report: IInstrumentReport,
  maxReports: number,
): { events: string[]; ranked: IEventPriorityRank[] } => {
  const ranked = rankNewEventsForReporting(report);

  return {
    events: ranked.slice(0, maxReports).map((entry) => entry.eventName),
    ranked,
  };
};

export const formatPrioritizationReason = (
  focusEvents: string[],
  ranked: IEventPriorityRank[],
): string => {
  return focusEvents
    .map((eventName, index) => {
      const rank = ranked.find((entry) => entry.eventName === eventName);

      return `${index + 1}. ${eventName} (${rank?.reasons.join("; ") ?? "selected"})`;
    })
    .join(" · ");
};
