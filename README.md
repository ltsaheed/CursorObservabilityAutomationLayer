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

Individual pipeline phases (used by the reusable workflow for visible CI steps; state persists in `.instrument/state/`):

```bash
instrument pre-scan --config <path> --workspace-root <path> [--changed-files ...]
instrument code-agent --config <path> --workspace-root <path> --pr-url <url> ...
instrument review --config <path> --workspace-root <path> ...
instrument dashboard --config <path> --workspace-root <path> ...
instrument deploy --config <path> --workspace-root <path> ...
instrument comment --config <path> --workspace-root <path> --repo owner/repo --pr-number 123
```

## GitHub Actions (consumer repos)

App repos call the reusable workflow from this repo:

```yaml
jobs:
  instrument:
    permissions:
      contents: read
      pull-requests: write
    uses: YOUR_ORG/instrument/.github/workflows/instrument-reusable.yml@main
    with:
      tooling-repo: YOUR_ORG/instrument
      workspace-root: .
      config-path: instrument.config.json
      dry-run: false
    secrets: inherit
```

The caller job must grant `pull-requests: write` so Instrument can post the sticky PR comment.

See [instrument-sample-app](https://github.com/YOUR_ORG/instrument-sample-app) for a full consumer example.

### Secrets

**Org-level (shared):**

- `CURSOR_API_KEY`
- `MIXPANEL_SERVICE_ACCOUNT_USERNAME`
- `MIXPANEL_SERVICE_ACCOUNT_SECRET`

**Per-app repo:**

- `MIXPANEL_PROJECT_ID`
- `MIXPANEL_WORKSPACE_ID`
- `MIXPANEL_REGION` (`us` or `in` only if your Mixpanel URL starts with `mixpanel.com` or `in.mixpanel.com`; defaults to EU)
- `MIXPANEL_DASHBOARD_ID` (optional)

**Not required for deploy:** Mixpanel project token and API secret. Those are for client-side event tracking in your app (for example `VITE_MIXPANEL_TOKEN`), not for Instrument's dashboard deploy step.

**Finding IDs:** Open Mixpanel and copy the numbers from the URL:

`https://eu.mixpanel.com/project/<MIXPANEL_PROJECT_ID>/view/<MIXPANEL_WORKSPACE_ID>/app/boards`

For US projects use `https://mixpanel.com/project/...` and set `MIXPANEL_REGION=us`.

Grant the service account access to the project and workspace in Mixpanel org settings.

## Configuration

Each app provides `instrument.config.json` with analytics wrapper paths, event naming conventions, and optional scan globs.

## Development

```bash
npm run build
npm run test
npm run typecheck
```

## Pipeline phases

Instrument orchestrates **three Cursor agents** via the Cursor SDK:

| Agent | Runtime | Role |
| --- | --- | --- |
| **Code Agent** | Cursor Cloud Agent on the PR | Adds instrumentation, commits to the branch, writes `.instrument/report.json` |
| **Review Agent** | Cursor SDK (`Agent.prompt`) | Independently checks instrumentation against org analytics standards; on failure, sends fix instructions back to the Code Agent (up to 2 fix rounds) |
| **Dashboard Agent** | Cursor SDK (`Agent.prompt`) | Plans Mixpanel insights/funnel reports from new events |

With `CURSOR_API_KEY` set, the Code Agent runs in Cursor Cloud against the PR (`Agent.create` + `prUrl`). GitHub Actions orchestrates the pipeline and posts PR comments; the **code changes come from the Cursor Cloud Agent**.

1. **Pre-scan** — detect missing tracking in changed page files
2. **Code Agent** — Cursor Cloud Agent adds instrumentation and writes `.instrument/report.json`
3. **Standards review** — a separate Review Agent checks the instrumentation against your org analytics standards (`.cursor/rules/analytics-standards.mdc`). If it fails, Instrument sends fix instructions to the Code Agent and re-runs the review (up to 2 fix rounds, 3 reviews total).
4. **Dashboard agent** — plans Mixpanel insights/funnel reports (only if standards review passes)
5. **Mixpanel deploy** — creates dashboard bookmarks via service account API
6. **GitHub comment** — sticky PR comment with decisions, review result, and Mixpanel links
7. **Inline review comments** — one comment per logical change block on the diff (justification + Mixpanel mapping), not one comment per line

Human reviewers still approve PR merge — Instrument does not auto-merge.

Inline comments are posted on the PR diff by Instrument (using `GITHUB_TOKEN`). Each comment covers a **change block** (a contiguous edit or logical group of lines in one file). The Code Agent defines blocks in `changeBlocks` inside `.instrument/report.json`; accurate `startLine`/`endLine` values are required for correct anchoring.
