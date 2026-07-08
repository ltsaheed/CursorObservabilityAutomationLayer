# Instrument — FDE Interview Notes (Copy-Paste)

Companion docs: [`REQUIREMENTS.md`](./REQUIREMENTS.md), [`DESIGN_DECISIONS.md`](./DESIGN_DECISIONS.md).

Use this for onsite prep. Bullet format for quick copy into your notes app.

---

## Onsite brief (what they're evaluating)

- **30-minute live demo** + **15-minute Q&A**
- Build with **Cursor Cloud Agent or Cursor SDK**
- Solve a **meaningful enterprise SDLC problem** (industry of your choice)
- **Excludes:** BugBot or Security Review clones
- Must clearly demonstrate Cursor can:
  - **Improve developer velocity**
  - **Reduce cognitive load**
  - **Increase code quality, safety, or consistency**
- Strong submissions: **well-scoped, opinionated, grounded in real enterprise constraints**
- Live session: explain problem, demo prototype, discuss trade-offs, state limitations, **extend live**

**Brief success-criteria tags used below:**

| Tag | Criterion |
|---|---|
| **Velocity** | Improve developer velocity |
| **Cognitive load** | Reduce cognitive load |
| **Quality** | Increase code quality, safety, or consistency |

---

## 30-second pitch (FDE reframe — lead with this)

> **Enterprises ship features constantly but can't prove which ones drive value. Instrument makes measurement automatic: every PR that touches a user-facing page gets instrumented, validated, and wired to a live dashboard — so product teams always know what's working, without developers spending time on it.**

Technical version (if they want SDK detail):

> **Instrument is a PR pipeline that detects missing analytics instrumentation, uses Cursor Cloud Agent to add compliant tracking code, validates it with an independent Review Agent, plans Mixpanel dashboards, and gives human reviewers per-line justification on the diff — without auto-merging.**

**Position as:** spec-to-implementation for analytics (not generic standards enforcement, not BugBot).

---

## The pain points

### Business / FDE pain (headline)

- Every shipped feature needs to **prove it adds value**
- Without measurement, leadership can't tell what's working vs noise
- Teams that can't demonstrate ROI **lose budget** and go to competitors
- **Instrumentation is the proof layer** for every product decision
- FDE adoption story: "we bought Cursor but can't show impact" if customer features aren't measured
- Developers won't instrument consistently unless it's **automatic and zero-friction**
- The blocker isn't "devs don't know Mixpanel" — it's **"devs don't have time, and nobody enforces it"**

### Developer / SDLC pain (evidence)

- PM requests an event → engineer bolts `mixpanel.track()` into an **unrelated PR**
- **No naming convention enforced** — `checkout_viewed`, `Checkout Viewed`, `checkout_page_view` all live in prod
- Six months later the **data team can't build funnels**
- **Senior engineers resent** the work → skipped under deadline pressure
- **Junior engineers get it wrong** → PII leaks, wrong property shapes, duplicate helpers
- Instrumentation is **tedious, low-status, error-prone** — best ROI for agentic tooling

### Reviewer / platform pain

- Reviewers see bare `track()` calls with **no context** on why or where they go
- Platform team can't roll out **one paved road** across N repos without per-repo forks
- Data team files tickets **after merge** instead of getting consistent events at merge time

---

## Why this problem / why Instrument

### Why it's the right shape for Cursor agents

- **High frequency** — every PR touching a page is a candidate
- **Mechanical enough** — gap detection is regex; generation follows ADR-031 patterns
- **Error-prone by hand** — naming, helper reuse, property shapes all drift
- **Low-status work** — best ROI for agentic tooling
- **End-to-end SDLC impact** — code → standards → dashboard → reviewer feedback

### Why NOT the PDF example spaces

- **PR review assistant** → excluded (BugBot territory)
- **Context-aware refactoring** → too broad for 30-min demo
- **Incident follow-up** → reactive, not preventive
- **Standards enforcement alone** → too narrow; you embed it as one gate in a larger flow
- **Spec-to-implementation** → **your headline** — gap → code → dashboard → review evidence

### Why NOT "standards enforcement" as the headline

- Brief struck through that example — reads as "this alone is not enough"
- Instrument's pitch is broader: **turn a coverage gap into shipped, compliant tracking + a live Mixpanel dashboard**
- Standards review is one phase inside that flow, not the whole product

---

## Maps to brief's three success criteria

### Developer velocity

- **Pain:** Devs must learn wrapper API, remember naming rules, file data-team tickets on top of shipping the feature
- **Instrument:** Agent closes gaps on every PR; pre-scan is deterministic (no LLM); reusable workflow rolls out once across N repos; `--skip-code-agent` for staged pilot; dashboard exists without manual data-team ask
- **One-liner:** Devs ship features; measurement happens automatically — zero extra steps

### Reduce cognitive load

- **Pain:** Reviewers must hold entire analytics taxonomy in their head; context-switch to Mixpanel and ADR-031 mid-PR
- **Instrument:** Inline PR comments carry justification + Mixpanel link on the exact line; sticky comment summarizes all phases; run history on same PR (up to 8 runs); GHA steps have title + subtitle
- **One-liner:** Reviewer sees "this event → this dashboard metric" on the diff — no context-switching

### Code quality, safety, consistency

- **Pain:** Inconsistent events, duplicate helpers, PII in payloads, skipped instrumentation
- **Instrument:** Independent Review Agent; ADR-031 as single source of truth; dedup decisions machine-checkable; bounded retry (`MAX_REVIEW_RETRIES = 2`); never auto-merge; Zod at every phase boundary
- **Honest gap:** PII control is Review Agent + standards rule today — no deterministic denylist yet (#1 customer-ready req)
- **One-liner:** Every feature measured the same way; bad instrumentation fails visibly, not silently

---

## Value chain (demo slide)

```
Feature ships unmeasured
        ↓
Leadership asks "did it work?"
        ↓
Nobody knows → blame the tool / cut budget

─────────────────────────────────────

Feature ships WITH Instrument
        ↓
Events + dashboard exist before merge
        ↓
Leadership sees value within days, not quarters
        ↓
Justifies continued investment (in product AND in Cursor)
```

---

## Stakeholders

| Stakeholder | Need | Brief criterion |
|---|---|---|
| **Product / exec leadership** | Proof every feature drives value | Velocity |
| **PR author (developer)** | Ship feature without Mixpanel boilerplate | Velocity |
| **PR reviewer** | Approve/reject in seconds from the diff | Cognitive load |
| **Data / analytics team** | Consistent events + dashboard without tickets | Quality |
| **Platform / DX team** | One standards update propagates to all repos | Quality + Velocity |
| **Security / compliance** | No new DB, least-privilege tokens, no PII | Quality (safety) |
| **Eng leadership** | Reduced review burden, no unreviewed auto-merge | Safety |
| **FDE (you)** | Paved road: ship → metrics appear → value visible | All three |

---

## Architecture (7 phases)

1. **Pre-scan** (`preScan.ts`) — deterministic regex, NO LLM; detects gaps, builds analytics catalog
2. **Code Agent** (`codeAgent.ts`) — Cursor Cloud Agent; commits instrumentation + `.instrument/report.json`
3. **Sync workspace** — pull Code Agent commits onto GHA runner (live runs only)
4. **Standards review** (`standardsReviewLoop.ts`) — Review Agent; fail → `Agent.resume()` ≤2 retries
5. **Dashboard agent** (`dashboardAgent.ts`) — plans Mixpanel insights/funnels; deterministic fallback
6. **Mixpanel deploy** (`mixpanelDeploy.ts`) — service account API, creates dashboard bookmarks
7. **PR feedback** (`github.ts`, `reviewComments.ts`) — sticky PR comment + inline review comments on change blocks
8. **Human merge approval** — always required

- Orchestrator: `runPipeline.ts` (full run) + per-phase CLI commands for visible GHA steps
- GitHub feedback always runs in `finally` — partial results always reported
- State persists in `.instrument/state/` between GHA steps

---

## Three Cursor agents

| Agent | SDK API | Runtime | Why |
|---|---|---|---|
| **Code Agent** | `Agent.create()` + `agent.send()` | **Cloud** | CI has no persistent local app workspace; commits directly to PR branch |
| **Review Agent** | `Agent.prompt()` | **Local** | Loads `.cursor/rules/analytics-standards.mdc` via `settingSources: ["project"]` |
| **Dashboard Agent** | `Agent.prompt()` | **Local** | Reads structured report from disk; degrades independently |

### Cloud Agent config (key flags)

- `workOnCurrentBranch: true` — commits onto existing PR branch, no competing PR
- `skipReviewerRequest: true` — Instrument's Review Agent + sticky comment IS the review surface
- `agent.agentId` preserved — enables `Agent.resume()` for fix cycles
- Model: `composer-2.5`

### Standards review loop

- Separate Review Agent — agent grading its own homework is a weak control
- On failure: `Agent.resume(codeAgentId)` — retains context (files touched, helper choices)
- `MAX_REVIEW_RETRIES = 2` — max 3 review attempts total, then `StandardsReviewError`
- Fail closed and visible, not loop indefinitely

### Structured artifact contract

- Every phase communicates via Zod-validated `.instrument/report.json`
- Not free-text agent output
- Downstream phases unit-testable with fixtures, zero network calls
- 43+ orchestrator tests passing

### What we deliberately did NOT add

- No Pre-scan Agent — gap detection is mechanical; LLM would waste tokens
- No Merge Agent — human merge is a hard safety boundary
- No PII Scanner Agent — should be deterministic denylist (future), not another LLM call
- No per-file agents — one Code Agent per PR keeps cost bounded and context coherent

---

## Functional requirements (detailed)

### FR-A — Detection & Assessment

*Goal: find what's missing before any AI writes code — scoped, testable, cheap.*

#### FR-A1 — Gap detection without a live model call
- **Tags:** Velocity, Quality
- **Requirement:** Identify page components missing required analytics events (page views, tracked actions) without calling an LLM
- **Why it matters:** Gap detection is mechanical; LLM re-discovery wastes latency, tokens, money; deterministic = unit-testable offline
- **Acceptance criteria:**
  - Output assessment per page file with gap kinds and triggering lines/handlers
  - Runs with no `CURSOR_API_KEY` and no network
  - Typed/schema-validated (`ICoverageAssessment`)
- **Status: Met** — `preScan.ts`, `preScan.test.ts`

#### FR-A2 — Analytics catalog discovery
- **Tags:** Velocity, Quality
- **Requirement:** Discover existing wrapper module, exported helpers, conventions so generated code extends patterns
- **Why it matters:** Common failure is a third slightly different helper, not zero tracking; Code Agent needs structured context before editing
- **Acceptance criteria:**
  - Read configured analytics module; list exported helpers
  - Pass catalog to Code Agent in pre-scan assessment
  - Prefer reuse when gap matches helper shape
- **Status: Met** — `analyticsCatalog.ts`

#### FR-A3 — Per-repo configuration without forking the tool
- **Tags:** Velocity (platform rollout)
- **Requirement:** Configurable wrapper path, naming template, scan globs per repo without modifying Instrument source
- **Why it matters:** FDE rolls out to multiple repos with different layouts; config file scales, forks don't
- **Acceptance criteria:**
  - `instrument.config.json` validated by `instrumentConfigSchema`
  - Invalid config fails at startup
- **Status: Met** — `instrument.config.json` + schema

---

### FR-B — Instrumentation Generation

*Goal: close gaps with repo-fitting code + machine-readable record of what changed and why.*

#### FR-B1 — Helper reuse hierarchy with recorded decisions
- **Tags:** Velocity, Quality
- **Requirement:** Preference order: reuse → extend → create helper → inline `track()`; record choice + reason per event
- **Why it matters:** Duplicate helpers make data unusable later; recorded decision = audit trail for reviewers
- **Acceptance criteria:**
  - Each event has `deduplicationDecision` with `choice` and `reason` in report JSON
  - Code Agent prompt + Review Agent enforce hierarchy
- **Status: Met** — `deduplicationDecisionSchema`

#### FR-B2 — Per-event justification and line anchoring
- **Tags:** Cognitive load, Quality
- **Requirement:** Every event has human-readable justification + source line for inline PR comment
- **Why it matters:** Reviewers verify a stated claim, not reconstruct intent from bare `track()` calls
- **Acceptance criteria:**
  - `instrumentEventSchema` requires `justification` and `line`
  - Inline comments reference justification + Mixpanel destination
- **Status: Met** — `instrumentEventSchema`

#### FR-B3 — Schema-validated generation artifact
- **Tags:** Quality, Velocity (testability)
- **Requirement:** Output is `.instrument/report.json` validated by Zod, not ad hoc prose parsing
- **Why it matters:** Probabilistic agent output fenced behind deterministic validation; unit tests use fixtures
- **Acceptance criteria:**
  - Code Agent commits report to PR branch
  - `instrumentReportSchema.parse()` before any consumer reads it
- **Status: Met** — report schema + parse

#### FR-B4 — Assessment-only mode
- **Tags:** Velocity (safe pilot)
- **Requirement:** Skip code generation entirely (`--skip-code-agent`)
- **Why it matters:** Enterprise adoption is staged — prove gap detection before granting write access
- **Acceptance criteria:**
  - Flag skips Code Agent; other phases behave predictably
  - Workflow input `skip-code-agent: true` maps to same flag
- **Status: Met** — `--skip-code-agent`

---

### FR-C — Standards Enforcement

*Goal: independent check, bounded auto-fix, never silent pass, never auto-merge.*

#### FR-C1 — Independent reviewer distinct from generator
- **Tags:** Quality, Safety
- **Requirement:** Separate reviewer checks generated code against org standards before passing
- **Why it matters:** Agent grading own homework is weak control; mirrors human code review
- **Acceptance criteria:**
  - `reviewAgent.ts` separate invocation from `codeAgent.ts`
  - Typed `IStandardsReviewResult` with `passed`, `issues[]`, `summary`
- **Status: Met** — `reviewAgent.ts`

#### FR-C2 — Single standards source of truth
- **Tags:** Quality, Velocity (no prompt drift)
- **Requirement:** One artifact for humans and automation — not standards copy-pasted into prompts
- **Why it matters:** Prompt-only standards drift silently from what engineers follow
- **Acceptance criteria:**
  - Standards in `.cursor/rules/analytics-standards.mdc`
  - Review Agent loads via `settingSources: ["project"]`
  - New rule in `.mdc` sufficient to change enforcement
- **Status: Met** — analytics-standards.mdc

#### FR-C3 — Bounded automatic fix with loud failure
- **Tags:** Quality, Velocity
- **Requirement:** On failure, resume Code Agent with issues; max 2 retries; fail loud if exceeded
- **Why it matters:** One-shot generation misses edge cases; unbounded loops burn CI time and tokens
- **Acceptance criteria:**
  - `MAX_REVIEW_RETRIES = 2` (3 review attempts max)
  - `Agent.resume(codeAgentId)` with structured issues
  - `StandardsReviewError` after bound; partial results still posted
- **Status: Met** — `standardsReviewLoop.ts`

#### FR-C4 — No auto-merge under any outcome
- **Tags:** Safety
- **Requirement:** Never auto-merge PR regardless of pass/fail/partial
- **Why it matters:** LLM-authored analytics touches production telemetry; human approval non-negotiable
- **Acceptance criteria:**
  - No merge API call in pipeline
  - README + PR comment state human approval required
- **Status: Met** — no merge call anywhere

---

### FR-D — Dashboard Planning & Deployment

*Goal: connect events to measurable outcomes — leadership can look day one.*

#### FR-D1 — Event-to-dashboard mapping with stated reason
- **Tags:** Cognitive load, Velocity (data team)
- **Requirement:** Map each new event to insights/funnel report with stated reason; works without live model
- **Why it matters:** Instrumentation without destination = data team tickets after merge
- **Acceptance criteria:**
  - `IDashboardPlan` with reports, event names, type, `reason`
  - AI path when `CURSOR_API_KEY` set; deterministic fallback otherwise
- **Status: Met** — `dashboardAgent.ts` + `buildDashboardPlanDeterministic`

#### FR-D2 — Independently disable-able dashboard deploy
- **Tags:** Velocity (staged rollout)
- **Requirement:** Deploy separable from code generation
- **Why it matters:** Mixpanel access often restricted separately from repo write access
- **Acceptance criteria:**
  - `--reports-only` skips API calls
  - Missing Mixpanel env vars → deploy skipped, not hard failure
- **Status: Met** — `--reports-only` + env check

---

### FR-E — Feedback & Reporting

*Goal: every stakeholder sees what happened on the PR, not in CI logs.*

#### FR-E1 — Single sticky PR status comment
- **Tags:** Cognitive load
- **Requirement:** One updated-in-place PR comment summarizing all phase outcomes
- **Why it matters:** Multiple bot comments get ignored; sticky marker is enterprise pattern
- **Acceptance criteria:**
  - Find-or-create by `BOT_MARKER`
  - Phase timeline, overall status, review result, Mixpanel links
- **Status: Met** — `syncPrComment`

#### FR-E2 — Inline diff comments with justification and destination
- **Tags:** Cognitive load
- **Requirement:** Per-change-block justification + Mixpanel destination on the diff
- **Why it matters:** Primary "reduce cognitive load" deliverable — approve from diff alone
- **Acceptance criteria:**
  - Comments anchored to change blocks
  - Justification, properties, Mixpanel URL (deployed or planned)
  - Stale comments deleted and reposted each run
- **Status: Met** — `reviewComments.ts`

#### FR-E3 — Run history across pipeline executions
- **Tags:** Cognitive load, Observability
- **Requirement:** History visible across multiple runs on same PR, not latest only
- **Why it matters:** PRs cycle through failed/passed attempts; reviewers shouldn't dig in Actions logs
- **Acceptance criteria:**
  - History in sticky comment via `instrument-run-history` marker
  - Capped at `MAX_RUN_HISTORY = 8`
- **Status: Met** — `parseRunHistoryFromComment` / `appendRunHistory`

#### FR-E4 — Dry-run parity with live run output shape
- **Tags:** Velocity (CI testing, demo safety)
- **Requirement:** Dry-run produces same schemas, comment structure, phase sequencing as live
- **Why it matters:** Demos and CI tests must not depend on API keys or Cloud Agent latency
- **Acceptance criteria:**
  - Realistic mocks in all agent phases
  - PR + inline comments still generated
- **Status: Met** — dry-run fallbacks everywhere

---

### FR-F — Operational Controls

*Goal: roll out once from central tooling repo; app repos opt in with minimal YAML.*

#### FR-F1 — Reusable workflow integration
- **Tags:** Velocity (platform rollout)
- **Requirement:** Consumable via few lines CI config + secrets, not vendored source
- **Why it matters:** Platform team fixes prompts once; all consumers benefit on next run
- **Acceptance criteria:**
  - `instrument-reusable.yml` via `workflow_call`
  - Consumer passes tooling-repo, config-path, flags
- **Status: Met** — reusable workflow

#### FR-F2 — Separable org-level and per-repo secrets
- **Tags:** Security, Velocity (multi-repo)
- **Requirement:** Org secrets (Cursor API, Mixpanel service account) separable from per-repo project/workspace IDs
- **Why it matters:** One org credential serves many app repos pointing at different Mixpanel projects
- **Acceptance criteria:**
  - Org: `CURSOR_API_KEY`, `MIXPANEL_SERVICE_ACCOUNT_*`
  - Per-repo: `MIXPANEL_PROJECT_ID`, `MIXPANEL_WORKSPACE_ID`, etc.
- **Status: Met** — README Secrets section

---

## Non-functional requirements (detailed)

### NFR-1 — Reliability & Graceful Degradation

- **Requirement:** Agent failure degrades quality, not availability — run completes with honest partial result
- **Why it matters:** CI that hard-crashes gets disabled; partial success with visible failure is operable
- **What good looks like:**
  - Dashboard planning → deterministic fallback, continues
  - Code generation → phase fails, PR comment still posted
  - Standards review → phase fails, no false "passed"
  - Mixpanel deploy → skipped if creds missing
  - GitHub comment → runs in `finally`, always attempts post
- **Status:** Met for dashboard; **Partial** for code/review (deliberate — no safe deterministic substitute for "write this code")

---

### NFR-2 — Security & Least Privilege

- **Requirement:** Minimize credential scope, no new infra attack surface, no PII in payloads
- **Sub-requirements:**
  - Job-scoped `GITHUB_TOKEN`, not standing PAT → **Met**
  - No new datastore (Postgres/Redis/S3) as adoption prerequisite; state in PR comment → **Met**
  - No PII in generated `track()` property keys → **Partial**
- **PII gap (say proactively):** ADR-031 rule + Review Agent today; need **deterministic property-key denylist** as hard gate before compliance-sensitive rollout
- **Highest-priority gap for compliance customers**

---

### NFR-3 — Performance & Cost

- **Requirement:** Bounded agent invocations, no LLM for mechanical work, eventually transparent spend
- **Sub-requirements:**
  - `MAX_REVIEW_RETRIES = 2` caps round trips → **Met**
  - Pre-scan/catalog without model calls → **Met**
  - Per-run token/cost in PR comment → **Gap**
- **Cost gap:** Finance/eng leadership will ask cost per repo per month before org-wide rollout

---

### NFR-4 — Observability & Auditability

- **Requirement:** Reconstruct what pipeline did, why, and where to debug — without raw agent chat
- **Sub-requirements:**
  - Structured phase logging to CI + `GITHUB_STEP_SUMMARY` → **Met** (`progressReporter.ts`)
  - Human-readable GHA step names (title + subtitle) → **Met** (`phaseDescriptions.ts`)
  - Durable audit trail in committed `.instrument/report.json` + PR comments → **Met**
  - `agent.agentId` linked from PR comment to Cursor dashboard → **Gap** (CI stdout only today)

---

### NFR-5 — Scalability & Multi-Tenancy

- **Requirement:** Scale from one design-partner repo to many without forks; no unbounded PR state
- **Sub-requirements:**
  - Central standards/prompt updates propagate on next run → **Met**
  - Run history capped (`MAX_RUN_HISTORY = 8`) → **Met**
  - Cross-repo aggregate coverage view → **Gap** (acceptable for pilot; blocker for VP reporting)

---

### NFR-6 — Maintainability & Extensibility

- **Requirement:** Typed phase boundaries; localized extensions; vendor isolation
- **Sub-requirements:**
  - Zod schemas at every phase boundary in `types.ts` → **Met**
  - New gap kind / report type / ADR rule touches owning module + schema only → **Met** (Design Decisions §5)
  - Mixpanel in `@instrument/mixpanel-client`, not orchestrator core → **Met**

---

### NFR-7 — Portability & Compatibility

- **Requirement:** Eventually support multiple app shapes; v1 scopes to one
- **Current state:** React PageComponent + `src/lib/analytics.ts`-shaped wrapper only
- **Status: Gap** — correct for one design-partner repo; real gap when second shape onboards
- **Mitigation:** AST detection (`ts-morph`) with same `ICoverageGap[]` output schema

---

### NFR-8 — Usability (Reviewer-Facing)

- **Requirement:** Approve/reject from GitHub diff alone — no Mixpanel tab, no standards doc tab
- **Why it matters:** Usability bar for "reduce cognitive load" brief criterion
- **Acceptance criteria:**
  - Inline comments: justification + Mixpanel link
  - Sticky comment: phase outcomes + pass/fail
  - Phase timeline uses human-readable titles
- **Status: Met** — inline comments + phase descriptions in PR timeline

---

## Key design decisions (with rejected alternatives)

- **Pre-scan:** deterministic regex before any LLM
  - Rejected: Code Agent detect + fix in one shot
  - Trade-off: regex brittle vs AST; speed-to-prototype

- **Code Agent runtime:** Cloud Agent on PR
  - Rejected: local agent in Actions runner
  - Trade-off: requires `CURSOR_API_KEY`; gains isolation + resumability

- **Fix cycle:** `Agent.resume()` same agent
  - Rejected: fresh agent each retry
  - Trade-off: 3 attempts max before human intervention

- **Review:** separate Review Agent
  - Rejected: Code Agent self-report
  - Trade-off: extra latency/cost; stronger control

- **Phase contract:** Zod-validated JSON artifact
  - Rejected: parse agent prose per consumer
  - Trade-off: agent must produce valid JSON

- **Dry-run:** realistic mocks in every agent phase
  - Rejected: hard-fail without API key
  - Benefit: CI tests + controlled live demo

- **State store:** PR comment (no database)
  - Rejected: external DB
  - Trade-off: no cross-repo querying

- **Deployment:** reusable workflow
  - Rejected: vendored script
  - Benefit: platform team owns one repo

- **Merge:** never auto-merge
  - Rejected: auto-merge on green checks
  - Reason: human always approves LLM-authored analytics

---

## Technology stack — what & why

### Runtime & language

- **Node.js 22+** — native ESM, `node --test`, GHA support; matches Cursor TS SDK
  - Not Python — SDK is TypeScript-first
  - Not Deno/Bun — weaker enterprise CI adoption

- **TypeScript (strict)** — shared types across orchestrator, schemas, Mixpanel client
  - Not plain JS — too many cross-phase contracts for implicit shapes

### Packages & libraries

- **npm workspaces** — `@instrument/orchestrator` + `@instrument/mixpanel-client` boundary
  - Not Turborepo/Nx — two packages, overhead not worth it for prototype

- **Zod** — runtime validation + inferred TS types at phase boundaries
  - Not JSON Schema alone — DRY with types

- **Commander** — thin CLI for local dev, Actions, demo

- **@cursor/sdk** — required by brief; Cloud Agent + `Agent.prompt` + `Agent.resume`

- **@actions/core** — CI logging + `GITHUB_STEP_SUMMARY`

- **Native fetch (Node 22)** — GitHub + Mixpanel API; no axios/Octokit bloat for narrow use case

### Platform choices

- **GitHub Actions reusable workflow** — PRs already live here; zero new infra
  - Not webhook microservice — needs hosting, on-call, auth
  - Not vendored script — forks immediately

- **PR comment as state store** — no DB to provision/secure
  - Not Postgres/Redis — adoption blocker for platform teams

- **Mixpanel App API** — concrete proof layer: feature ships → dashboard exists
  - Not "just emit events" — dashboard deploy closes the loop

- **`.cursor/rules/analytics-standards.mdc`** — single source for humans + Review Agent
  - Not standards baked into prompt only — drifts

- **Regex pre-scan (v1)** — milliseconds, zero model cost, unit-testable
  - Not ts-morph (v1) — right for one design-partner; swap for second shape

---

## How we know it works

1. **43+ unit tests, all passing** — pre-scan, catalog, review loop, dashboard planner, review comments, report loader, github comment builder, mixpanel client
   - Proves: every phase boundary works with fixtures, zero network
   - Does NOT prove: live Code Agent quality on arbitrary repos (no eval harness yet)

2. **Full pipeline dry-run end-to-end** — same schemas, comments, phase sequencing as live
   - CI runs build → typecheck → test on every PR to tooling repo

3. **Structured artifact contract** — invalid JSON → Zod error → phase fails loud

4. **Independent Review Agent** — dry-run simulates fail attempt 1, pass attempt 2

5. **Graceful degradation tested/explicit** — no API key → mocks; dashboard failure → deterministic plan; comment in `finally`

6. **FDE deployment model validated by design** — reusable workflow, org vs per-repo secrets, zero database

---

## Explicit non-goals (v1 — say before they ask)

- Not a general PR review assistant (BugBot/security excluded by brief)
- Not multi-analytics-vendor yet (Mixpanel only)
- Not a replacement for human merge approval
- Not a historical analytics-health reporting tool (per-PR gate only)
- Not framework-agnostic (React + `src/lib/analytics.ts` shape)

---

## Customer-ready gate (before 2nd design partner)

1. Deterministic PII property-key denylist (NFR-2)
2. Eval set of labeled gap/fix fixtures to score agent output quality over time
3. Per-run cost visibility in PR comment (NFR-3)
4. AST-based detection (`ts-morph`) for second framework/shape

---

## 30-min demo script

- **0–3 min** — Problem framing (unmeasured features = unprovable ROI; then naming drift as evidence)
- **3–5 min** — Architecture diagram (phases, 3 agents, Cloud vs local)
- **5–8 min** — Enterprise deployment (reusable workflow, org vs per-repo secrets, zero infra)
- **8–12 min** — Dry-run live (`npm run instrument -- run --dry-run ...`)
- **12–18 min** — PR output (sticky comment, run history, inline review comments, GHA step names)
- **18–22 min** — Standards loop (dry-run simulates fail → resume → pass)
- **22–26 min** — Live agent if stable (flip `CURSOR_API_KEY`)
- **26–30 min** — Limitations + roadmap (regex, PII denylist, eval suite, cost visibility)

**Demo safety net:** dry-run is fully deterministic — no Cloud Agent latency dependency

---

## Live extension options (be ready)

1. **New coverage-gap kind** — add to `coverageGapKindSchema` + `preScan.ts` (e.g. missing error-state tracking)
2. **New Mixpanel report type** — extend `reportPlanSchema` (e.g. `retention`)
3. **New ADR rule** — add to `analytics-standards.mdc`; show Review Agent catch it live

---

## Q&A prep

**Why not BugBot?**
- BugBot = general code review
- Instrument = domain-specific: analytics wrappers, Mixpanel dashboards, ADR-031 with structured artifacts

**Why Cloud for code, local for review?**
- Code Agent commits to PR branch in isolated workspace → Cloud
- Review Agent needs `.cursor/rules/` via `settingSources: ["project"]` → local

**What happens when agent fails?**
- Dashboard → deterministic fallback
- Code/review → fail check but still post honest partial result to PR comment
- No silent pass

**How prevent PII?**
- ADR-031 rule + Review Agent today
- Production: deterministic property-key denylist as hard gate (#1 customer-ready req)

**Scale to 40 repos?**
- Reusable workflow + org secrets already support it
- Missing: cross-repo coverage dashboard, per-run cost tracking, AST detection for varied shapes

**Why analytics instrumentation specifically?**
- Every enterprise needs it on every feature but nobody does it consistently
- Can't prove anything else you're deploying is working (including Cursor) without measurement at scale

**What's the ROI for the customer?**
- Features go from "shipped and forgotten" to "shipped with a live dashboard"
- Product leadership gets proof within days; developers spend zero extra time

**How does this relate to Cursor?**
- Cursor accelerates how fast teams ship
- Instrument ensures what they ship is measured
- Without both: velocity without visibility — visibility keeps the contract

**Why not standards enforcement alone?**
- Enforcement without dashboards still leaves leadership blind
- Instrument connects code to outcomes

---

## One-paragraph "why this tech stack" (Q&A closer)

> I chose TypeScript + Node 22 because the Cursor SDK is TypeScript-native and every enterprise customer already runs GitHub Actions. Zod validates every agent-to-pipeline boundary so probabilistic LLM output can't silently corrupt deterministic downstream steps. I split into three agents — not one — because code generation, standards review, and dashboard planning have different runtime needs and different trust models: Cloud Agent commits to the PR, local agents load project rules from disk, and the Review Agent is deliberately independent so the generator can't grade its own homework. I kept pre-scan deterministic because gap detection is mechanical and shouldn't burn tokens. And I know the scaffolding works because 43+ unit tests cover every phase boundary with fixtures and zero network calls — the honest gap is live agent output quality, which is why my next investment would be an eval set, not more architecture.

---

## What makes this stand out (Principal / FDE level)

- Requirements doc with honest **Met / Partial / Gap** scoring
- Pain framing tied to **brief's three success criteria**, not just "naming is messy"
- Three-agent architecture with deliberate runtime choices (Cloud vs local)
- `Agent.resume()` for fix cycles — SDK depth, not just `Agent.create()`
- Structured artifact contract — Zod at every phase boundary
- Zero-infra enterprise deployment — reusable workflow, PR comment as state
- Dry-run as first-class path — testable, demo-safe, production-degradable
- GHA steps with **title + subtitle** so operators know what's happening
- Explicit non-goals and customer-ready gates — know where prototype ends and product begins

---

## Repo layout & secrets (quick reference)

**Repo layout:**
- `packages/orchestrator` — CLI + pipeline (`@instrument/orchestrator`)
- `packages/mixpanelClient` — Mixpanel App API client (`@instrument/mixpanel-client`)
- Demo app — separate repo (`instrument-sample-app`)
- Docs — `docs/DESIGN_DECISIONS.md`, `docs/REQUIREMENTS.md`, `docs/INTERVIEW_NOTES.md`
- CI — `.github/workflows/instrument-reusable.yml` (consumer), `ci.yml` (this repo)

**Secrets model:**
- **Org-level:** `CURSOR_API_KEY`, `MIXPANEL_SERVICE_ACCOUNT_USERNAME/SECRET`
- **Per-app repo:** `MIXPANEL_PROJECT_ID`, `MIXPANEL_WORKSPACE_ID`, `MIXPANEL_REGION` (optional), `MIXPANEL_DASHBOARD_ID` (optional)
