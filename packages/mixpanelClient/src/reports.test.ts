import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MixpanelAppApiError } from "./client.js";
import {
  createBookmark,
  createDashboard,
  deployDashboardPlan,
} from "./reports.js";
import type { IMixpanelClientConfig, IDashboardPlan } from "./types.js";

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

  test("given a dashboard plan this should create dashboard and bookmarks", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const config: IMixpanelClientConfig = {
      ...baseConfig,
      fetchImpl: createMockFetch((url, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url,
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
          return new Response(
            JSON.stringify({
              status: "ok",
              results: { id: 500, title: "Instrument Reports" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            status: "ok",
            results: {
              id: requests.filter((entry) => entry.url.includes("/bookmarks")).length,
              name: "Report",
              type: "insights",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    };
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Checkout Retry Views",
          description: "Daily views",
          event: "Checkout Retry Viewed",
          reason: "New page",
        },
        {
          type: "funnels",
          name: "Checkout Retry Funnel",
          description: "Retry flow",
          steps: ["Checkout Started", "Checkout Retry Viewed"],
          reason: "Multi-step flow",
        },
      ],
    };

    const result = await deployDashboardPlan({ config, plan });

    assert.equal(result.createdDashboard, true);
    assert.equal(result.dashboardId, 500);
    assert.equal(result.reports.length, 2);
    assert.match(result.dashboardUrl, /#id=500$/);
    assert.match(result.reports[0]?.reportUrl, /report-1/);
    assert.equal(requests.filter((entry) => entry.url.includes("/bookmarks")).length, 2);
    assert.equal(
      requests.filter(
        (entry) => entry.method === "PATCH" && entry.url.includes("/dashboards/500"),
      ).length,
      2,
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
              results: { id: 777, title: "Instrument Reports" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            status: "ok",
            results: { id: 1, name: "Report", type: "insights" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    };
    const plan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Checkout Retry Views",
          description: "Daily views",
          event: "Checkout Retry Viewed",
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
