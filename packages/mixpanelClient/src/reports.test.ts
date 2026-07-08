import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MixpanelAppApiError } from "./client.js";
import {
  createBookmark,
  createDashboard,
  createInlineReportOnDashboard,
  deployDashboardPlan,
  findReportOnDashboard,
} from "./reports.js";
import type { IMixpanelClientConfig, IDashboardPlan, IMixpanelDashboardDetail } from "./types.js";

const baseConfig: IMixpanelClientConfig = {
  serviceAccountUsername: "sa_test",
  serviceAccountSecret: "secret_test",
  projectId: "12345",
  workspaceId: "67890",
};

const createMockFetch = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch => {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const resolvedUrl = typeof url === "string" ? url : url.toString();

    return Promise.resolve(handler(resolvedUrl, init));
  }) as typeof fetch;
};

const dashboardWithReport = (
  dashboardId: number,
  contentId: number,
  bookmarkId: number,
  name: string,
): IMixpanelDashboardDetail => ({
  id: dashboardId,
  title: "Instrument Reports",
  contents: {
    report: {
      [String(contentId)]: {
        id: bookmarkId,
        name,
        type: "insights",
      },
    },
  },
});

describe("packages/mixpanelClient/src/reports.ts", () => {
  test("given dashboard params this should POST to the workspace dashboards path", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          url,
          body: JSON.parse(String(init?.body)),
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            results: { id: 99, title: "Instrument Reports" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    };

    const dashboard = await createDashboard(config, {
      title: "Instrument Reports",
    });

    assert.equal(dashboard.id, 99);
    assert.match(requests[0]?.url, /workspaces\/67890\/dashboards$/);
    assert.deepEqual(requests[0]?.body, { title: "Instrument Reports" });
  });

  test("given bookmark params this should POST dashboard_id and bookmark type", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          url,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            results: { id: 42, name: "Checkout Retry Views", type: "insights" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    };

    const bookmark = await createBookmark(config, {
      name: "Checkout Retry Views",
      bookmarkType: "insights",
      dashboardId: 99,
      params: { series: [] },
      description: "Daily views",
    });

    assert.equal(bookmark.id, 42);
    assert.match(requests[0]?.url, /workspaces\/67890\/bookmarks$/);
    assert.equal(requests[0]?.body.dashboard_id, 99);
    assert.equal(requests[0]?.body.type, "insights");
    assert.equal(requests[0]?.body.v, 2);
    assert.equal(typeof requests[0]?.body.params, "object");
    assert.deepEqual(requests[0]?.body.params, { series: [] });
  });

  test("given inline report params this should PATCH dashboard with stringified bookmark params", async () => {
    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> =
      [];
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            results: dashboardWithReport(500, 90001, 42, "Checkout Retry Views"),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    };

    const dashboard = await createInlineReportOnDashboard(config, 500, {
      name: "Checkout Retry Views",
      bookmarkType: "insights",
      params: { sections: { show: [] } },
      description: "Daily views",
    });

    assert.equal(dashboard.id, 500);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "PATCH");
    assert.match(requests[0]?.url, /\/dashboards\/500$/);

    const content = requests[0]?.body.content as Record<string, unknown>;
    const contentParams = content.content_params as Record<string, unknown>;
    const bookmark = contentParams.bookmark as Record<string, unknown>;

    assert.equal(content.action, "create");
    assert.equal(content.content_type, "report");
    assert.equal(typeof bookmark.params, "string");
    assert.equal(bookmark.name, "Checkout Retry Views");
  });

  test("given dashboard contents this should find report by name", () => {
    const located = findReportOnDashboard(
      dashboardWithReport(500, 90001, 42, "Checkout Retry Views"),
      "Checkout Retry Views",
    );

    assert.deepEqual(located, { contentId: 90001, bookmarkId: 42 });
  });

  test("given an API error this should throw MixpanelAppApiError", async () => {
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch(() => {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    };

    await assert.rejects(
      () => createDashboard(config, { title: "Instrument Reports" }),
      (error: unknown) => {
        assert.ok(error instanceof MixpanelAppApiError);
        assert.equal((error as MixpanelAppApiError).status, 401);

        return true;
      },
    );
  });

  test("given a dashboard plan this should create dashboard and inline reports on the board", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> =
      [];
    let inlineReportCount = 0;
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : undefined,
        });

        if (init?.method === "POST" && /\/dashboards$/.test(url)) {
          return new Response(
            JSON.stringify({
              status: "ok",
              results: { id: 500, title: "Instrument Reports" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (init?.method === "PATCH" && /\/dashboards\/500$/.test(url)) {
          inlineReportCount += 1;
          const name =
            inlineReportCount === 1 ? "Checkout Retry Views" : "Checkout Retry Funnel";

          return new Response(
            JSON.stringify({
              status: "ok",
              results: dashboardWithReport(500, 90000 + inlineReportCount, inlineReportCount, name),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ status: "ok", results: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    };
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Checkout Retry Views",
          description: "Daily views",
          event: "checkout_retry_viewed",
          reason: "New page",
        },
        {
          type: "funnels",
          name: "Checkout Retry Funnel",
          description: "Retry flow",
          steps: ["checkout_started", "checkout_retry_viewed"],
          reason: "Multi-step flow",
        },
      ],
    };

    const result = await deployDashboardPlan({ config, plan });

    assert.equal(result.createdDashboard, true);
    assert.equal(result.dashboardId, 500);
    assert.equal(result.reports.length, 2);
    assert.match(result.dashboardUrl, /#id=500$/);
    assert.equal(result.reports[0]?.bookmarkId, 1);
    assert.equal(
      requests.filter((entry) => entry.method === "PATCH" && entry.url.includes("/dashboards/500"))
        .length,
      2,
    );
    assert.equal(
      requests.some((entry) => entry.method === "POST" && entry.url.includes("/bookmarks")),
      false,
    );
  });

  test("given an existing dashboard id this should skip dashboard creation", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      dashboardId: "777",
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url,
        });

        if (init?.method === "PATCH" && /\/dashboards\/777$/.test(url)) {
          return new Response(
            JSON.stringify({
              status: "ok",
              results: dashboardWithReport(777, 90001, 1, "Checkout Retry Views"),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ status: "ok", results: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    };
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Checkout Retry Views",
          description: "Daily views",
          event: "checkout_retry_viewed",
          reason: "New page",
        },
      ],
    };

    const result = await deployDashboardPlan({ config, plan });

    assert.equal(result.createdDashboard, false);
    assert.equal(result.dashboardId, 777);
    assert.equal(
      requests.some((entry) => entry.method === "POST" && /\/dashboards$/.test(entry.url)),
      false,
    );
  });
});
