import { minimatch } from "minimatch";

import { discoverAnalyticsCatalog } from "./analyticsCatalog.js";
import { getDefaultScanGlobs, getExcludeGlobs } from "./config.js";
import type {
  IAnalyticsCatalog,
  ICoverageAssessment,
  ICoverageGap,
  IInstrumentConfig,
} from "./types.js";

const PAGE_COMPONENT_PATTERN = /export\s+(?:const|function)\s+(\w+Page)\b/;
const TRACK_IMPORT_PATTERN =
  /import\s*\{[^}]*\b(?:track|trackPageView|trackAction)\b[^}]*\}\s*from\s*['"][^'"]+['"]/;
const USE_EFFECT_PATTERN = /useEffect\s*\(/;
const TRACK_CALL_PATTERN = /\btrack\s*\(\s*['"`]([^'"`]+)['"`]/g;
const TRACK_PAGE_VIEW_PATTERN = /\btrackPageView\s*\(\s*['"`]([^'"`]+)['"`]/g;
const ON_CLICK_PATTERN = /onClick\s*=\s*\{?([^}\n;]+)/g;
const LINK_ON_CLICK_PATTERN = /<Link\b[^>]*onClick\s*=\s*\{([^}]+)\}/g;

const toPageSlug = (pageName: string): string => {
  const withoutSuffix = pageName.replace(/Page$/, "");

  return withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
};

const formatPageViewEvent = (config: IInstrumentConfig, pageSlug: string): string => {
  return config.analytics.requiredEvents.pageView.replace("{page}", pageSlug);
};

const matchesAnyGlob = (filePath: string, globs: string[]): boolean => {
  return globs.some((glob) => minimatch(filePath, glob, { dot: true }));
};

const extractPageName = (content: string, filePath: string): string | undefined => {
  const match = content.match(PAGE_COMPONENT_PATTERN);

  if (match?.[1]) {
    return match[1];
  }

  const baseName = filePath.split("/").pop()?.replace(/\.(tsx|ts|jsx|js)$/, "");

  return baseName;
};

const findLineNumber = (content: string, search: string | RegExp): number | undefined => {
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (typeof search === "string" ? line.includes(search) : search.test(line)) {
      return index + 1;
    }
  }

  return undefined;
};

const resolveHandlerBody = (content: string, handler: string): string | null => {
  const identifier = handler.replace(/[{}]/g, "").trim();

  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) {
    return handler;
  }

  const functionPatterns = [
    new RegExp(`const\\s+${identifier}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\};`),
    new RegExp(
      `function\\s+${identifier}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}`,
    ),
  ];

  for (const pattern of functionPatterns) {
    const match = content.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

const handlerCallsTrack = (content: string, handler: string): boolean => {
  if (handler.includes("track(") || handler.includes("trackAction(")) {
    return true;
  }

  const handlerBody = resolveHandlerBody(content, handler);

  return (
    (handlerBody?.includes("track(") ?? false) ||
    (handlerBody?.includes("trackAction(") ?? false)
  );
};

const collectTrackCalls = (content: string): string[] => {
  const events: string[] = [];
  let match = TRACK_CALL_PATTERN.exec(content);

  while (match) {
    events.push(match[1]);
    match = TRACK_CALL_PATTERN.exec(content);
  }

  TRACK_CALL_PATTERN.lastIndex = 0;

  let pageViewMatch = TRACK_PAGE_VIEW_PATTERN.exec(content);

  while (pageViewMatch) {
    events.push(`${pageViewMatch[1]}_viewed`);
    pageViewMatch = TRACK_PAGE_VIEW_PATTERN.exec(content);
  }

  TRACK_PAGE_VIEW_PATTERN.lastIndex = 0;

  return events;
};

const analyzePageFile = (
  filePath: string,
  content: string,
  config: IInstrumentConfig,
): ICoverageGap[] => {
  const gaps: ICoverageGap[] = [];
  const pageName = extractPageName(content, filePath);
  const pageSlug = pageName ? toPageSlug(pageName) : undefined;
  const expectedPageView = pageSlug
    ? formatPageViewEvent(config, pageSlug)
    : undefined;
  const trackCalls = collectTrackCalls(content);
  const hasTrackImport = TRACK_IMPORT_PATTERN.test(content);

  if (!hasTrackImport) {
    gaps.push({
      file: filePath,
      line: findLineNumber(content, "export const") ?? findLineNumber(content, "export function"),
      kind: "missing_track_import",
      description: `Missing analytics import (track/trackPageView/trackAction) from ${config.analytics.wrapper.module}`,
      pageName,
    });
  }

  if (expectedPageView && !trackCalls.includes(expectedPageView)) {
    const hasUseEffect = USE_EFFECT_PATTERN.test(content);

    gaps.push({
      file: filePath,
      line: findLineNumber(content, USE_EFFECT_PATTERN) ?? findLineNumber(content, "<main"),
      kind: "missing_page_view",
      description: hasUseEffect
        ? `Missing page view event ${expectedPageView} in useEffect`
        : `Missing useEffect page view event ${expectedPageView}`,
      pageName,
    });
  }

  const onClickMatches = [...content.matchAll(ON_CLICK_PATTERN)];

  for (const onClickMatch of onClickMatches) {
    const handler = onClickMatch[1]?.trim() ?? "";

    if (!handler || handler === "handle") {
      continue;
    }

    if (handlerCallsTrack(content, handler)) {
      continue;
    }

    gaps.push({
      file: filePath,
      line: findLineNumber(content, onClickMatch[0]),
      kind: "onclick_without_track",
      description: `onClick handler "${handler}" does not call track()`,
      pageName,
    });
  }

  const linkMatches = [...content.matchAll(LINK_ON_CLICK_PATTERN)];

  for (const linkMatch of linkMatches) {
    const handler = linkMatch[1]?.trim() ?? "";

    if (!handlerCallsTrack(content, handler)) {
      gaps.push({
        file: filePath,
        line: findLineNumber(content, linkMatch[0]),
        kind: "onclick_without_track",
        description: `Link onClick handler "${handler}" does not call track()`,
        pageName,
      });
    }
  }

  if (content.includes("<Link") && !content.includes("onClick=")) {
    gaps.push({
      file: filePath,
      line: findLineNumber(content, "<Link"),
      kind: "handler_without_track",
      description: "Interactive Link without onClick track handler",
      pageName,
    });
  }

  return gaps;
};

export const runPreScan = (
  changedFiles: string[],
  fileContents: Map<string, string>,
  config: IInstrumentConfig,
  workspaceRoot?: string,
): ICoverageAssessment => {
  const includeGlobs = getDefaultScanGlobs(config);
  const excludeGlobs = getExcludeGlobs(config);
  const scannedFiles: string[] = [];
  const gaps: ICoverageGap[] = [];

  for (const filePath of changedFiles) {
    if (!matchesAnyGlob(filePath, includeGlobs)) {
      continue;
    }

    if (matchesAnyGlob(filePath, excludeGlobs)) {
      continue;
    }

    const content = fileContents.get(filePath);

    if (!content) {
      continue;
    }

    scannedFiles.push(filePath);
    gaps.push(...analyzePageFile(filePath, content, config));
  }

  const summary =
    gaps.length === 0
      ? `Scanned ${scannedFiles.length} file(s); no instrumentation gaps detected.`
      : `Scanned ${scannedFiles.length} file(s); found ${gaps.length} instrumentation gap(s).`;

  const analyticsCatalog: IAnalyticsCatalog | undefined = workspaceRoot
    ? discoverAnalyticsCatalog(workspaceRoot, config)
    : undefined;

  return {
    scannedFiles,
    gaps,
    summary,
    analyticsCatalog,
  };
};

export const filterChangedFiles = (
  changedFiles: string[],
  config: IInstrumentConfig,
): string[] => {
  const includeGlobs = getDefaultScanGlobs(config);
  const excludeGlobs = getExcludeGlobs(config);

  return changedFiles.filter((filePath) => {
    if (!matchesAnyGlob(filePath, includeGlobs)) {
      return false;
    }

    return !matchesAnyGlob(filePath, excludeGlobs);
  });
};
