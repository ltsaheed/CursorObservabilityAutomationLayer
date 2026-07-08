import type { IGitHubCommentContext } from "./github.js";
import { fetchPullRequestHeadSha } from "./reviewComments.js";
import type { IInstrumentReport } from "./types.js";
import { instrumentReportSchema } from "./types.js";

export const REPORT_RELATIVE_PATH = ".instrument/report.json";

const GITHUB_API_BASE = "https://api.github.com";
const FETCH_RETRY_ATTEMPTS = 6;
const FETCH_RETRY_DELAY_MS = 5000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const githubRequest = async <T>(
  token: string,
  path: string,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
};

interface IGithubContentFile {
  content?: string;
  encoding?: string;
}

const derivePageNameFromFile = (file: string): string => {
  const baseName = file.split("/").pop() ?? "UnknownPage";

  return baseName.replace(/\.(tsx|ts|jsx|js)$/, "");
};

const normalizeEvent = (event: unknown): Record<string, unknown> | null => {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.event === "string"
        ? record.event
        : "";

  if (!name) {
    return null;
  }

  const properties =
    record.properties && typeof record.properties === "object"
      ? record.properties
      : {};

  return {
    name,
    properties,
    trigger: typeof record.trigger === "string" ? record.trigger : "unspecified",
    ...(typeof record.line === "number" ? { line: record.line } : {}),
    ...(typeof record.justification === "string"
      ? { justification: record.justification }
      : {}),
    ...(typeof record.visibility === "string" ? { visibility: record.visibility } : {}),
  };
};

const normalizePage = (page: unknown): Record<string, unknown> | null => {
  if (!page || typeof page !== "object") {
    return null;
  }

  const record = page as Record<string, unknown>;
  const file =
    typeof record.file === "string"
      ? record.file
      : typeof record.path === "string"
        ? record.path
        : "";
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.pageName === "string"
        ? record.pageName
        : typeof record.page === "string"
          ? record.page
          : file
            ? derivePageNameFromFile(file)
            : "UnknownPage";
  const events = Array.isArray(record.events)
    ? record.events.map(normalizeEvent).filter((event): event is Record<string, unknown> => event !== null)
    : [];

  return {
    name,
    file: file || `src/pages/${name}.tsx`,
    events,
  };
};

const normalizeDeduplicationChoice = (
  raw: unknown,
): "reuse" | "extend" | "create" | "inline" => {
  if (typeof raw !== "string") {
    return "reuse";
  }

  if (raw === "reuse" || raw === "extend" || raw === "create" || raw === "inline") {
    return raw;
  }

  if (raw === "inline_skip" || raw === "skip" || raw === "skipped") {
    return "inline";
  }

  const normalized = raw.toLowerCase();

  if (normalized.includes("create")) {
    return "create";
  }

  if (normalized.includes("extend")) {
    return "extend";
  }

  if (normalized.includes("inline")) {
    return "inline";
  }

  return "reuse";
};

const normalizeDeduplicationDecision = (
  entry: unknown,
): Record<string, unknown> | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const reason =
    typeof record.reason === "string"
      ? record.reason
      : typeof record.summary === "string"
        ? record.summary
        : typeof record.message === "string"
          ? record.message
          : "";

  if (!reason) {
    return null;
  }

  const helper =
    typeof record.helper === "string"
      ? record.helper
      : typeof record.name === "string"
        ? record.name
        : undefined;

  return {
    choice: normalizeDeduplicationChoice(
      record.choice ?? record.action ?? record.decision ?? record.type,
    ),
    reason,
    ...(helper ? { helper } : {}),
  };
};

const normalizeDeduplicationDecisions = (
  entries: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map(normalizeDeduplicationDecision)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

export const normalizeReportPayload = (
  parsed: Record<string, unknown>,
): Record<string, unknown> => {
  const pages = Array.isArray(parsed.pages)
    ? parsed.pages.map(normalizePage).filter((page): page is Record<string, unknown> => page !== null)
    : [];
  const newEvents = Array.isArray(parsed.newEvents)
    ? parsed.newEvents.filter((event): event is string => typeof event === "string")
    : pages.flatMap((page) =>
        Array.isArray(page.events)
          ? page.events
              .map((event) => (event as Record<string, unknown>).name)
              .filter((event): event is string => typeof event === "string")
          : [],
      );
  const filesChanged = Array.isArray(parsed.filesChanged)
    ? parsed.filesChanged.filter((file): file is string => typeof file === "string")
    : pages.map((page) => page.file).filter((file): file is string => typeof file === "string");

  return {
    version: "1",
    prSummary: typeof parsed.prSummary === "string" ? parsed.prSummary : "",
    pages,
    newEvents: [...new Set(newEvents)],
    filesChanged: [...new Set(filesChanged)],
    helpersUsed: Array.isArray(parsed.helpersUsed)
      ? parsed.helpersUsed.filter((helper): helper is string => typeof helper === "string")
      : [],
    helpersCreated: Array.isArray(parsed.helpersCreated)
      ? parsed.helpersCreated.filter((helper): helper is string => typeof helper === "string")
      : [],
    deduplicationDecisions: normalizeDeduplicationDecisions(parsed.deduplicationDecisions),
    changeBlocks: Array.isArray(parsed.changeBlocks) ? parsed.changeBlocks : [],
  };
};

export const parseInstrumentReportJson = (
  raw: string,
): { report: IInstrumentReport | null; error?: string } => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = normalizeReportPayload(parsed);

    return { report: instrumentReportSchema.parse(normalized) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid report JSON";

    return { report: null, error: message };
  }
};

const decodeGithubContent = (file: IGithubContentFile): string | null => {
  if (!file.content || file.encoding !== "base64") {
    return null;
  }

  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
};

export const fetchReportFromPullRequest = async (
  context: IGitHubCommentContext,
  filePath: string = REPORT_RELATIVE_PATH,
): Promise<{ raw: string | null; ref: string }> => {
  const ref = await fetchPullRequestHeadSha(context);
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const path = `/repos/${context.repo.owner}/${context.repo.repo}/contents/${encodedPath}?ref=${ref}`;
      const file = await githubRequest<IGithubContentFile>(context.token, path);
      const raw = decodeGithubContent(file);

      if (raw) {
        return { raw, ref };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("GitHub fetch failed");

      if (attempt < FETCH_RETRY_ATTEMPTS) {
        await sleep(FETCH_RETRY_DELAY_MS);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { raw: null, ref };
};

export const extractReportCandidatesFromText = (text: string): string[] => {
  const candidates: string[] = [];

  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];

  for (const match of fencedMatches) {
    if (match[1]?.includes('"version"')) {
      candidates.push(match[1].trim());
    }
  }

  const inlineMatches = [...text.matchAll(/\{[\s\S]*?"version"\s*:\s*"1"[\s\S]*?\}/g)];

  for (const match of inlineMatches) {
    candidates.push(match[0]);
  }

  return candidates;
};

export const extractReportFromAgentResult = (
  resultText: string,
): { report: IInstrumentReport | null; error?: string } => {
  const candidates = extractReportCandidatesFromText(resultText);

  for (const candidate of candidates) {
    const parsed = parseInstrumentReportJson(candidate);

    if (parsed.report) {
      return parsed;
    }
  }

  return {
    report: null,
    error: candidates.length > 0 ? "Report JSON found but failed schema validation" : "No report JSON in agent result",
  };
};

export interface ILoadInstrumentReportOptions {
  workspaceRoot: string;
  agentResultText?: string;
  github?: IGitHubCommentContext;
}

export const loadInstrumentReport = async (
  options: ILoadInstrumentReportOptions,
): Promise<{
  report: IInstrumentReport | null;
  source?: "workspace" | "github" | "agent-result";
  errors: string[];
}> => {
  const errors: string[] = [];

  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = readFileSync(join(options.workspaceRoot, REPORT_RELATIVE_PATH), "utf8");
    const parsed = parseInstrumentReportJson(raw);

    if (parsed.report) {
      return { report: parsed.report, source: "workspace", errors };
    }

    if (parsed.error) {
      errors.push(`workspace: ${parsed.error}`);
    }
  } catch {
    errors.push("workspace: file not found");
  }

  if (options.github) {
    try {
      const { raw, ref } = await fetchReportFromPullRequest(options.github);

      if (raw) {
        const parsed = parseInstrumentReportJson(raw);

        if (parsed.report) {
          return { report: parsed.report, source: "github", errors };
        }

        if (parsed.error) {
          errors.push(`github@${ref}: ${parsed.error}`);
        }
      } else {
        errors.push(`github@${ref}: empty file`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub fetch failed";
      errors.push(`github: ${message}`);
    }
  }

  if (options.agentResultText) {
    const parsed = extractReportFromAgentResult(options.agentResultText);

    if (parsed.report) {
      return { report: parsed.report, source: "agent-result", errors };
    }

    if (parsed.error) {
      errors.push(`agent-result: ${parsed.error}`);
    }
  }

  return { report: null, errors };
};
