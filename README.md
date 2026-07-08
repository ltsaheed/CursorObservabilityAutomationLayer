# Instrument

PR pipeline tooling that detects analytics instrumentation gaps, runs Cursor agents to add Mixpanel tracking, validates against standards, and plans Mixpanel dashboards.

## Repository layout

- `packages/orchestrator` — CLI and pipeline orchestration (`@instrument/orchestrator`)
- `packages/mixpanelClient` — Mixpanel App API client (`@instrument/mixpanel-client`)

The demo app lives in a separate repo: [instrument-sample-app](https://github.com/YOUR_ORG/instrument-sample-app).

## Prerequisites

- Node.js 22+
- npm workspaces
- Optional: `CURSOR_API_KEY` for live cloud agents
- Optional: Mixpanel service account credentials for dashboard deploy

## Setup

```bash
npm install
cp .env.example .env   # fill in credentials as needed
npm run build
```

## Local dry run

Run against the sample app checkout (sibling directory):

```bash
npm run instrument -- run \
  --config ../instrument-sample-app/instrument.config.json \
  --workspace-root ../instrument-sample-app \
  --dry-run \
  --changed-files src/pages/CheckoutRetryPage.tsx
```

## CLI options

```bash
instrument run \
  --config <path> \
  --workspace-root <path> \
  [--repo owner/repo] \
  [--pr-number 123] \
  [--pr-url https://github.com/owner/repo/pull/123] \
  [--dry-run] \
  [--reports-only] \
  [--skip-code-agent] \
  [--changed-files file1 file2]
```

## GitHub Actions (consumer repos)

App repos call the reusable workflow from this repo:

```yaml
jobs:
  instrument:
    uses: YOUR_ORG/instrument/.github/workflows/instrument-reusable.yml@main
    with:
      tooling-repo: YOUR_ORG/instrument
      workspace-root: .
      config-path: instrument.config.json
      dry-run: ${{ !secrets.CURSOR_API_KEY }}
    secrets: inherit
```

See [instrument-sample-app](https://github.com/YOUR_ORG/instrument-sample-app) for a full consumer example.

### Secrets

**Org-level (shared):**

- `CURSOR_API_KEY`
- `MIXPANEL_SERVICE_ACCOUNT_USERNAME`
- `MIXPANEL_SERVICE_ACCOUNT_SECRET`

**Per-app repo:**

- `MIXPANEL_PROJECT_ID`
- `MIXPANEL_WORKSPACE_ID`
- `MIXPANEL_DASHBOARD_ID` (optional)

## Configuration

Each app provides `instrument.config.json` with analytics wrapper paths, event naming conventions, and optional scan globs.

## Development

```bash
npm run build
npm run test
npm run typecheck
```

## Pipeline phases

1. **Pre-scan** — detect missing tracking in changed page files
2. **Code agent** — Cursor cloud agent adds instrumentation and writes `.instrument/report.json`
3. **Standards review** — Cursor Review Agent validates against ADR-031; on failure, `Agent.resume` fixes Code Agent (max 2 retries)
4. **Dashboard agent** — plans Mixpanel insights/funnel reports (only if standards review passes)
5. **Mixpanel deploy** — creates dashboard bookmarks via service account API
6. **GitHub comment** — sticky PR comment with decisions, review result, and Mixpanel links

Human reviewers still approve PR merge — Instrument does not auto-merge.
