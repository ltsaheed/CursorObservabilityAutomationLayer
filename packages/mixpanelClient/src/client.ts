import type { IMixpanelApiResponse, IMixpanelClientConfig } from "./types.js";

export const DEFAULT_MIXPANEL_APP_API_BASE = "https://mixpanel.com/api/app/";

export class MixpanelAppApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "MixpanelAppApiError";
    this.status = status;
    this.body = body;
  }
}

export interface IMixpanelHttpClient {
  post<T>(path: string, body: Record<string, unknown>): Promise<T>;
}

const resolveApiPath = (
  template: string,
  projectId: string,
  workspaceId: string,
): string => {
  return template
    .replaceAll("{projectId}", projectId)
    .replaceAll("{workspaceId}", workspaceId);
};

const buildAuthHeader = (username: string, secret: string): string => {
  const credentials = Buffer.from(`${username}:${secret}`).toString("base64");

  return `Basic ${credentials}`;
};

const parseJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const unwrapResults = <T>(payload: unknown): T => {
  if (payload && typeof payload === "object" && "results" in payload) {
    const results = (payload as IMixpanelApiResponse<T>).results;

    if (results !== undefined) {
      return results;
    }
  }

  return payload as T;
};

export const createMixpanelHttpClient = (
  config: IMixpanelClientConfig,
): IMixpanelHttpClient => {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_MIXPANEL_APP_API_BASE;
  const authHeader = buildAuthHeader(
    config.serviceAccountUsername,
    config.serviceAccountSecret,
  );

  const post = async <T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    const url = new URL(path.replace(/^\//, ""), baseUrl).toString();
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const responseBody = await parseJsonBody(response);

    if (!response.ok) {
      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof (responseBody as { error?: string }).error === "string"
          ? (responseBody as { error: string }).error
          : `Mixpanel App API request failed with status ${response.status}`;

      throw new MixpanelAppApiError(message, response.status, responseBody);
    }

    return unwrapResults<T>(responseBody);
  };

  return {
    post,
  };
};

export const getCreateDashboardPath = (config: IMixpanelClientConfig): string => {
  const template =
    config.apiPaths?.createDashboardPath ??
    "workspaces/{workspaceId}/dashboards";

  return resolveApiPath(template, config.projectId, config.workspaceId);
};

export const getCreateBookmarkPath = (config: IMixpanelClientConfig): string => {
  const template =
    config.apiPaths?.createBookmarkPath ?? "workspaces/{workspaceId}/bookmarks";

  return resolveApiPath(template, config.projectId, config.workspaceId);
};
