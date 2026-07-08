import type { IInstrumentEvent, IInstrumentReport } from "./types.js";

export const CHANGE_BLOCK_LINE_GAP = 5;

export interface IReviewCommentBlockTarget {
  file: string;
  startLine: number;
  endLine: number;
  justification: string;
  events: IInstrumentEvent[];
}

const indexEventsByName = (report: IInstrumentReport): Map<string, IInstrumentEvent> => {
  const events = new Map<string, IInstrumentEvent>();

  for (const page of report.pages) {
    for (const event of page.events) {
      events.set(event.name, event);
    }
  }

  return events;
};

const collectInstrumentedEvents = (
  report: IInstrumentReport,
): Array<{ file: string; event: IInstrumentEvent }> => {
  if (report.newEvents.length === 0 || report.filesChanged.length === 0) {
    return [];
  }

  const newEventNames = new Set(report.newEvents);
  const changedFiles = new Set(report.filesChanged);
  const entries: Array<{ file: string; event: IInstrumentEvent }> = [];

  for (const page of report.pages) {
    if (!changedFiles.has(page.file)) {
      continue;
    }

    for (const event of page.events) {
      if (event.line && newEventNames.has(event.name)) {
        entries.push({ file: page.file, event });
      }
    }
  }

  return entries;
};

export const clusterEventsIntoChangeBlocks = (
  report: IInstrumentReport,
): IReviewCommentBlockTarget[] => {
  const entries = collectInstrumentedEvents(report);

  if (entries.length === 0) {
    return [];
  }

  const byFile = new Map<string, IInstrumentEvent[]>();

  for (const { file, event } of entries) {
    const fileEvents = byFile.get(file) ?? [];
    fileEvents.push(event);
    byFile.set(file, fileEvents);
  }

  const blocks: IReviewCommentBlockTarget[] = [];

  for (const [file, fileEvents] of byFile) {
    const sorted = [...fileEvents].sort((left, right) => (left.line ?? 0) - (right.line ?? 0));
    let current: IInstrumentEvent[] = [];

    for (const event of sorted) {
      const line = event.line ?? 0;
      const previousLine = current.length > 0 ? (current[current.length - 1]?.line ?? 0) : line;

      if (current.length > 0 && line - previousLine > CHANGE_BLOCK_LINE_GAP) {
        blocks.push(buildBlockTarget(file, current));
        current = [event];
        continue;
      }

      current.push(event);
    }

    if (current.length > 0) {
      blocks.push(buildBlockTarget(file, current));
    }
  }

  return blocks;
};

const buildBlockTarget = (
  file: string,
  events: IInstrumentEvent[],
): IReviewCommentBlockTarget => {
  const lines = events.map((event) => event.line ?? 0);
  const startLine = Math.min(...lines);
  const endLine = Math.max(...lines);
  const justification = buildClusteredJustification(events);

  return {
    file,
    startLine,
    endLine,
    justification,
    events,
  };
};

const buildClusteredJustification = (events: IInstrumentEvent[]): string => {
  if (events.length === 1) {
    return events[0]?.justification ?? events[0]?.trigger ?? "Instrumentation added.";
  }

  return events
    .map((event) => {
      const detail = event.justification ?? event.trigger;

      return `- \`${event.name}\`: ${detail}`;
    })
    .join("\n");
};

export const collectReviewCommentBlockTargets = (
  report: IInstrumentReport,
): IReviewCommentBlockTarget[] => {
  const changedFiles = new Set(report.filesChanged);

  if (report.changeBlocks && report.changeBlocks.length > 0) {
    const eventsByName = indexEventsByName(report);
    const blocks: IReviewCommentBlockTarget[] = [];

    for (const block of report.changeBlocks) {
      if (!changedFiles.has(block.file)) {
        continue;
      }

      const events = block.events
        .map((eventName) => eventsByName.get(eventName))
        .filter((event): event is IInstrumentEvent => event !== undefined);

      blocks.push({
        file: block.file,
        startLine: block.startLine,
        endLine: block.endLine,
        justification: block.justification,
        events,
      });
    }

    if (blocks.length > 0) {
      return blocks;
    }
  }

  return clusterEventsIntoChangeBlocks(report);
};

/** @deprecated Use collectReviewCommentBlockTargets */
export const collectReviewCommentTargets = (
  report: IInstrumentReport,
): Array<{ file: string; line: number; event: IInstrumentEvent }> =>
  collectReviewCommentBlockTargets(report).flatMap((block) =>
    block.events.map((event) => ({
      file: block.file,
      line: event.line ?? block.startLine,
      event,
    })),
  );
