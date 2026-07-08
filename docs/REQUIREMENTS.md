# Instrument — Requirements (Staff FDE Framing)

Companion to [`DESIGN_DECISIONS.md`](./DESIGN_DECISIONS.md). That doc justifies *how*
the system is built; this one states *what it was obligated to do and be — the
requirements a staff-level Forward Deployed Engineer would write before calling this
pilot-ready for a customer, and an honest scorecard against them.

An FDE sits between the vendor (Cursor) and one specific customer's engineering org.
That changes what "requirements" means relative to a product spec: the bar isn't just
"does the feature work," it's "can this be rolled out into someone else's SDLC, on
their infra, under their security review, without a Cursor engineer in the room every
time." Every requirement below is written with that deployment reality in mind, and
each carries a status against the current prototype: **Met**, **Partial**, or **Gap**
— a staff FDE scopes a pilot by knowing exactly which gaps are acceptable for a
30-minute demo and which would block a real customer rollout.

Each functional requirement is tagged against the Cursor onsite brief's three success
criteria where it applies:

| Tag | Brief criterion |
|---|---|
| **Velocity** | Improve developer velocity |
| **Cognitive load** | Reduce cognitive load |
| **Quality** | Increase code quality, safety, or consistency |

## 0. Stakeholders

| Stakeholder | What they need from this system |
|---|---|
| PR author (app engineer) | Instrumentation added correctly without having to learn the analytics wrapper API by hand |
| PR reviewer | Enough context on the diff to approve/reject in seconds, not minutes |
| Platform/DX team (owns the tool) | One place to update standards; adoption across repos without per-repo forks |
| Data/analytics team | Events are named consistently and land on a dashboard without a manual ask |
| Security/compliance | No new persistent datastore, least-privilege tokens, no PII in tracking payloads |
| Customer engineering leadership | Evidence this reduces review burden and doesn't introduce an unreviewed auto-merge path |

---

## 1. Functional Requirements

### FR-A — Detection & Assessment

*Goal: find what's missing before any AI writes code, so the pipeline is scoped, testable, and cheap to run.*

#### FR-A1 — Gap detection without a live model call
**Tags:** Velocity, Quality

The system MUST identify, for a given set of changed files, which page components are
missing required analytics events (page view events and tracked user actions such as
button clicks) **without** calling an LLM.

**Why it matters:** Gap detection is mechanical. Running an agent to rediscover "this
file has no `track()` call" on every PR wastes latency, tokens, and money. Deterministic
detection also means platform teams can unit-test the scanner offline and trust the same
result in CI and locally.

**Acceptance criteria:**
- Given a list of changed files, output an assessment listing each page file, what gaps
  were found (missing page view, missing action tracking), and which lines/handlers
  triggered the finding.
- Pre-scan completes with no `CURSOR_API_KEY` and no network access.
- Gap kinds are typed and schema-validated (`ICoverageAssessment`).

**Status: Met** — `preScan.ts`; unit-tested in `preScan.test.ts`.

---

#### FR-A2 — Analytics catalog discovery
**Tags:** Velocity, Quality

The system MUST discover the customer's existing analytics helper surface — wrapper
module path, exported helpers (e.g. `trackPageView`, `trackAction`), and naming
conventions already in use — so generated code **extends existing patterns** instead of
inventing parallel ones.

**Why it matters:** The most common instrumentation failure mode in enterprise repos is
not "no tracking at all" but "a third slightly different helper that drifts from ADR."
The Code Agent needs structured context about what already exists before it edits files.

**Acceptance criteria:**
- Read the configured analytics module and list exported helper names.
- Pass the catalog to the Code Agent as structured input in the pre-scan assessment.
- Prefer reusing an existing helper when the gap matches its shape.

**Status: Met** — `analyticsCatalog.ts`.

---

#### FR-A3 — Per-repo configuration without forking the tool
**Tags:** Velocity (platform rollout)

Detection rules MUST be configurable per repo — analytics wrapper path, event-naming
template, include/exclude scan globs — **without modifying Instrument's source code**.

**Why it matters:** An FDE rolls this out to multiple app repos with different folder
layouts and wrapper paths. Per-repo forks of the orchestrator don't scale; a config file
does.

**Acceptance criteria:**
- Each app repo ships an `instrument.config.json` validated by `instrumentConfigSchema`.
- Changing wrapper path or globs requires no change to `@instrument/orchestrator`.
- Invalid config fails at startup with a parse error, not mid-pipeline.

**Status: Met** — `instrument.config.json` + `instrumentConfigSchema`.

---

### FR-B — Instrumentation Generation

*Goal: close detected gaps with code that fits the repo, and produce a machine-readable record of what changed and why.*

#### FR-B1 — Helper reuse hierarchy with recorded decisions
**Tags:** Velocity, Quality

The system MUST generate code that closes each detected gap using this preference order:
1. Reuse an existing helper when one fits exactly.
2. Extend an existing helper when the pattern is near-identical.
3. Create a new shared helper when multiple call sites would benefit.
4. Inline `track()` only as a last resort.

For every event, the system MUST record **which choice was made and why** (dedup
decision).

**Why it matters:** Duplicate helpers and inconsistent call patterns are what make
analytics data unusable six months later. Recording the decision lets reviewers verify
the agent didn't take the lazy path, and gives the data team an audit trail.

**Acceptance criteria:**
- Each event in `.instrument/report.json` includes a `deduplicationDecision` with
  `choice` (`reuse` | `extend` | `create` | `inline`) and `reason`.
- Code Agent prompt enforces the hierarchy; Review Agent can flag violations.

**Status: Met** — `deduplicationDecisionSchema`; enforced by prompt + Review Agent.

---

#### FR-B2 — Per-event justification and line anchoring
**Tags:** Cognitive load, Quality

Every generated event MUST carry a human-readable **justification** and the **source
line** it was added at, sufficient to anchor an inline PR review comment on the diff.

**Why it matters:** Reviewers shouldn't have to infer why a `track()` call exists. The
justification is the difference between "trust me" and "verify this claim on the line
below."

**Acceptance criteria:**
- `instrumentEventSchema` requires non-empty `justification` and numeric `line`.
- Inline review comments reference the justification and resolve to a Mixpanel destination.
- Missing line/justification prevents comment posting for that event.

**Status: Met** — `instrumentEventSchema` requires `justification`, `line`.

---

#### FR-B3 — Schema-validated generation artifact
**Tags:** Quality, Velocity (downstream testability)

Generation output MUST be a **schema-validated JSON artifact** (`.instrument/report.json`),
not free-text agent prose that downstream phases re-parse ad hoc.

**Why it matters:** Agent output is probabilistic. Funneling it through Zod at the phase
boundary means dashboard planning, review, and PR comments all consume the same typed
contract — and unit tests can run against fixtures with zero API calls.

**Acceptance criteria:**
- Code Agent commits `.instrument/report.json` to the PR branch.
- `instrumentReportSchema.parse()` runs before any consumer reads the report.
- Invalid or partial JSON fails the phase with a visible error.

**Status: Met** — `.instrument/report.json` + `instrumentReportSchema.parse()`.

---

#### FR-B4 — Assessment-only mode
**Tags:** Velocity (safe pilot rollout)

A run MUST be able to **skip code generation entirely** so teams can pilot gap detection
and PR feedback before granting write access to a Cloud Agent.

**Why it matters:** Enterprise adoption is staged. Platform teams need to prove "we
found the right gaps" before "we let an agent commit to your branch."

**Acceptance criteria:**
- `--skip-code-agent` flag skips the Code Agent phase.
- Pre-scan, review (if report exists), and comment phases still behave predictably.
- Workflow input `skip-code-agent: true` maps to the same flag.

**Status: Met** — `--skip-code-agent`.

---

### FR-C — Standards Enforcement

*Goal: generated instrumentation meets org standards through an independent check, with bounded auto-fix — never silent pass, never auto-merge.*

#### FR-C1 — Independent reviewer distinct from generator
**Tags:** Quality, Safety

Generated instrumentation MUST be checked against the org's written standards by a
**reviewer distinct from the generator** before the run is considered passing.

**Why it matters:** An agent grading its own homework is a weak control. Structural
separation mirrors human code review and is the minimum bar for compliance-shaped output.

**Acceptance criteria:**
- `reviewAgent.ts` is a separate Cursor SDK invocation from `codeAgent.ts`.
- Review reads changed files from disk and checks against ADR-031 rules.
- Review result is a typed `IStandardsReviewResult` with `passed`, `issues[]`, `summary`.

**Status: Met** — `reviewAgent.ts` as a separate agent invocation.

---

#### FR-C2 — Single standards source of truth
**Tags:** Quality, Velocity (no prompt drift)

The standards source of truth MUST be **one artifact** usable by both humans in their
editor and the automated reviewer — not a copy embedded in a prompt that can drift.

**Why it matters:** If ADR-031 lives only inside `reviewAgent.md`, the next prompt edit
silently changes what "compliant" means. Engineers and the Review Agent must read the
same file.

**Acceptance criteria:**
- Standards live in `.cursor/rules/analytics-standards.mdc`.
- Review Agent loads them via `settingSources: ["project"]` in local mode.
- Adding a rule to the `.mdc` file is sufficient to change enforcement (no orchestrator code change).

**Status: Met** — `.cursor/rules/analytics-standards.mdc` loaded via
`settingSources: ["project"]`.

---

#### FR-C3 — Bounded automatic fix with loud failure
**Tags:** Quality, Velocity

On standards review failure, the system MUST attempt a **bounded** automatic fix
(resume the Code Agent with structured issues) before escalating to a human. If the
retry bound is exceeded, the pipeline MUST **fail loudly** — not silently pass or merge.

**Why it matters:** One-shot generation will miss edge cases; unbounded retry loops burn
CI time and tokens. Failing visible is better than shipping non-compliant instrumentation.

**Acceptance criteria:**
- `MAX_REVIEW_RETRIES = 2` (max 3 review attempts per run).
- On failure: `Agent.resume(codeAgentId)` with issues from Review Agent.
- After bound exceeded: throw `StandardsReviewError`; PR check fails; partial results still posted.

**Status: Met** — `standardsReviewLoop.ts`, `MAX_REVIEW_RETRIES = 2`,
`StandardsReviewError`.

---

#### FR-C4 — No auto-merge under any outcome
**Tags:** Safety

The system MUST **NOT** auto-merge a pull request under any review outcome — pass,
fail, or partial.

**Why it matters:** LLM-authored analytics touches production telemetry. Human merge
approval is a non-negotiable safety boundary for enterprise customers and eng leadership.

**Acceptance criteria:**
- No GitHub merge API call exists anywhere in the pipeline.
- README and PR comment explicitly state human approval is required.
- A green Instrument check does not imply merge authority.

**Status: Met** — no merge call exists anywhere in the pipeline; README states this
explicitly.

---

### FR-D — Dashboard Planning & Deployment

*Goal: connect new events to measurable outcomes — not just code on the diff, but a live place leadership can look.*

#### FR-D1 — Event-to-dashboard mapping with stated reason
**Tags:** Cognitive load, Velocity (data team)

Every new event MUST be mapped to a proposed Mixpanel dashboard report (insights trend
or funnel) with a **stated reason** for the mapping, even when no live model call is
available.

**Why it matters:** Instrumentation without a destination leaves the data team filing
tickets after merge. The dashboard plan closes the loop from "we added an event" to
"here's where you'll see it."

**Acceptance criteria:**
- `IDashboardPlan` lists reports with event names, report type, and `reason`.
- Dashboard Agent (AI path) produces the plan when `CURSOR_API_KEY` is set.
- Deterministic fallback (`buildDashboardPlanDeterministic`) produces the same schema when AI is unavailable.

**Status: Met** — `dashboardAgent.ts` AI path + `buildDashboardPlanDeterministic`
fallback.

---

#### FR-D2 — Independently disable-able dashboard deploy
**Tags:** Velocity (staged rollout)

Dashboard deployment MUST be **independently disable-able** from code generation. A
customer may want instrumentation validated in PRs before allowing an automated agent to
write to their Mixpanel project.

**Why it matters:** Mixpanel project access is often restricted separately from repo
write access. Hard-coupling deploy to generation blocks pilots.

**Acceptance criteria:**
- `--reports-only` skips Mixpanel API calls while still planning reports.
- If Mixpanel env vars are absent, deploy phase is skipped (no hard failure).
- Instrumentation and review can complete without Mixpanel credentials.

**Status: Met** — `--reports-only`, and deploy is skipped entirely if Mixpanel env
vars are absent (no hard dependency).

---

### FR-E — Feedback & Reporting

*Goal: every stakeholder sees what happened, on the PR, without digging through CI logs.*

#### FR-E1 — Single sticky PR status comment
**Tags:** Cognitive load

Every run MUST produce **one** PR-level status comment that is **updated in place** (not
duplicated) summarizing pre-scan, generation, review, and dashboard outcomes.

**Why it matters:** Multiple bot comments per run train reviewers to ignore them. One
sticky comment with a clear marker is the enterprise pattern for CI feedback bots.

**Acceptance criteria:**
- Find-or-create by `BOT_MARKER` HTML comment in the PR body.
- Comment includes phase timeline, overall status, standards review result, Mixpanel links.
- Re-running the pipeline updates the same comment.

**Status: Met** — `syncPrComment` / `BOT_MARKER`-based find-or-create.

---

#### FR-E2 — Inline diff comments with justification and destination
**Tags:** Cognitive load

Reviewers MUST see **per-change-block justification** and the **Mixpanel destination**
for each instrumented change, directly on the PR diff — not only in the summary comment.

**Why it matters:** This is the primary "reduce cognitive load" deliverable. Reviewers
approve from the diff; they shouldn't open Mixpanel or ADR-031 in another tab to
understand a new `track()` call.

**Acceptance criteria:**
- `reviewComments.ts` posts comments anchored to change blocks on the diff.
- Each comment includes justification, event properties, and resolved Mixpanel URL (deployed or planned).
- Stale `instrument-review`-marked comments are deleted and reposted each run.

**Status: Met** — `reviewComments.ts`, re-synced (stale comments deleted) each run.

---

#### FR-E3 — Run history across pipeline executions
**Tags:** Cognitive load, Observability

Run history MUST be visible across **multiple pipeline executions** on the same PR (e.g.
after a push fixes a failed review), not just the latest run in isolation.

**Why it matters:** PRs often go through several CI cycles. Reviewers need to see
"attempt 1 failed on PII rule, attempt 2 passed" without opening Actions run logs.

**Acceptance criteria:**
- Run history embedded in the sticky comment via `instrument-run-history` marker.
- New runs prepend to history; capped at `MAX_RUN_HISTORY = 8` to prevent unbounded growth.
- Each entry includes run ID, URL, status, timestamp.

**Status: Met** — `parseRunHistoryFromComment` / `appendRunHistory`, capped at 8.

---

#### FR-E4 — Dry-run parity with live run output shape
**Tags:** Velocity (CI testing, demo safety)

Dry-run mode MUST produce the **same shaped output** as a live run — same Zod schemas,
same comment structure, same phase sequencing — so the feedback surface can be validated
without live Cursor or Mixpanel credentials.

**Why it matters:** Demos, CI tests, and design-partner onboarding all need a path that
doesn't depend on API keys or Cloud Agent latency.

**Acceptance criteria:**
- `--dry-run` uses realistic mocks in Code Agent, Review Agent, and Dashboard Agent.
- PR comment and inline comments are still generated (with mock/deterministic data).
- Unit tests and the onsite demo can run the full pipeline offline.

**Status: Met** — dry-run fallbacks in every agent module.

---

### FR-F — Operational Controls

*Goal: roll out once from a central tooling repo; each app repo opts in with minimal YAML.*

#### FR-F1 — Reusable workflow integration
**Tags:** Velocity (platform rollout)

The tool MUST be consumable by an app repo via a **small, declarative integration** (a
few lines of CI config + secrets), not a vendored copy of Instrument's source.

**Why it matters:** Platform/DX teams maintain one tooling repo. Bug fixes and prompt
updates propagate to every consumer on the next workflow run — no per-repo cherry-picks.

**Acceptance criteria:**
- Consumer calls `instrument-reusable.yml` via `workflow_call`.
- Consumer passes `tooling-repo`, `tooling-ref`, `config-path`, and optional flags.
- No copying of `packages/orchestrator` into app repos.

**Status: Met** — `instrument-reusable.yml` via `workflow_call`.

---

#### FR-F2 — Separable org-level and per-repo secrets
**Tags:** Security, Velocity (multi-repo rollout)

Per-repo secrets (Mixpanel project ID, workspace ID, optional dashboard ID) MUST be
separable from org-level shared secrets (Cursor API key, Mixpanel service account).

**Why it matters:** One Cursor API key and one Mixpanel service account serve the whole
org; each app repo points at its own Mixpanel project. This is how enterprise secret
management actually works.

**Acceptance criteria:**
- Org secrets documented: `CURSOR_API_KEY`, `MIXPANEL_SERVICE_ACCOUNT_*`.
- Per-repo secrets documented: `MIXPANEL_PROJECT_ID`, `MIXPANEL_WORKSPACE_ID`, etc.
- Workflow accepts both via `secrets: inherit` or explicit mapping.

**Status: Met** — documented split in README "Secrets" section.

---

## 2. Non-Functional Requirements

Non-functional requirements describe **how the system must behave** while meeting the
functional requirements above — reliability, security, cost, observability, and rollout
characteristics an enterprise platform team will ask about in a security review.

### NFR-1 — Reliability & Graceful Degradation

**Requirement:** Any single agent call failing or returning unparseable output MUST
degrade pipeline *quality*, not *availability* — the run should still complete and
report an honest partial result rather than crash the CI job without feedback.

**Why it matters:** CI that hard-crashes on one flaky agent call gets disabled by the
platform team. Partial success with visible failure is operable; silent crash is not.

**What good looks like:**
| Phase | On failure |
|---|---|
| Dashboard planning | Deterministic fallback plan; pipeline continues |
| Code generation | Phase fails; PR comment still posted with what ran |
| Standards review | Phase fails; no false "passed" status |
| Mixpanel deploy | Skipped if creds missing; instrumentation still reported |
| GitHub comment | Runs in `finally` — always attempts to post |

**Status:**
- **Met** for dashboard planning (deterministic fallback on any failure).
- **Partial** for code generation and review — phases correctly fail, but there is no
  safe deterministic substitute for "write this code." That asymmetry is deliberate, not
  an oversight: silently generating bad instrumentation would be worse than failing visible.

---

### NFR-2 — Security & Least Privilege

**Requirement:** The system must minimize credential scope, avoid new infrastructure
that expands the attack surface, and prevent PII from entering tracking payloads.

| Sub-requirement | Detail | Status |
|---|---|---|
| **Job-scoped tokens** | Use the Actions-provided `GITHUB_TOKEN` (scoped to the job), not a standing PAT with repo-wide write access. | **Met** |
| **No new datastore** | Do not require Postgres, Redis, or S3 as an adoption prerequisite. State lives in the PR comment and committed artifacts. | **Met** — see Design Decisions §3.9 |
| **No PII in payloads** | Generated `track()` calls must not include email, phone, card number, or other PII-shaped property keys. | **Partial** |

**PII gap (highest priority for compliance customers):** Today PII is blocked by an
ADR-031 rule and checked by the Review Agent (LLM judgment). That is not sufficient for
a compliance review — I'd add a **deterministic property-key denylist** as a hard gate
before merge-blocking authority. Say this proactively in the onsite.

---

### NFR-3 — Performance & Cost

**Requirement:** The pipeline must be bounded in agent invocations, cheap for mechanical
work, and eventually transparent about spend.

| Sub-requirement | Detail | Status |
|---|---|---|
| **Bounded retries** | No unbounded agent retry loops. `MAX_REVIEW_RETRIES = 2` caps at 3 code/review round trips per PR run. | **Met** |
| **No LLM for mechanical work** | Gap detection and catalog discovery run without model calls. | **Met** — see Design Decisions §3.1 |
| **Cost visibility** | Surface per-run token/cost estimate to the operator (e.g. in the PR comment). | **Gap** |

**Cost gap:** Finance and eng leadership will ask "what does this cost per repo per
month?" before org-wide rollout. The architecture supports bounded invocations; what's
missing is reporting.

---

### NFR-4 — Observability & Auditability

**Requirement:** Operators and reviewers must be able to reconstruct what the pipeline
did, why, and where to debug failures — without SSH-ing into CI or reading raw agent chat.

| Sub-requirement | Detail | Status |
|---|---|---|
| **Structured phase logging** | Every phase emits timestamped decisions and logs to CI stdout and `GITHUB_STEP_SUMMARY`. | **Met** — `progressReporter.ts`, `@actions/core` |
| **Human-readable step names** | GitHub Actions steps use title + subtitle so operators know what each phase does. | **Met** — `phaseDescriptions.ts`, reusable workflow |
| **Durable audit trail** | Every event's rationale is committed in `.instrument/report.json` and duplicated in PR comments. | **Met** |
| **Agent correlation ID** | Link `agent.agentId` from the PR comment to Cursor's dashboard for support/debug. | **Gap** |

**Correlation gap:** `agent.agentId` is logged to CI stdout but not surfaced in the PR
comment. A customer's support workflow would want that link one click away.

---

### NFR-5 — Scalability & Multi-Tenancy

**Requirement:** The system must scale from one design-partner repo to many repos
without per-repo forks, and must not accumulate unbounded state on long-lived PRs.

| Sub-requirement | Detail | Status |
|---|---|---|
| **Central standards/prompt updates** | Fix prompts or ADR rules once in the tooling repo; all consumers pick up changes on next run. | **Met** — reusable workflow, Design Decisions §3.10 |
| **Bounded PR comment state** | Run history capped so sticky comments don't grow forever. | **Met** — `MAX_RUN_HISTORY = 8` |
| **Cross-repo coverage reporting** | Aggregate view: "instrumentation health across 40 repos this quarter." | **Gap** |

**Aggregate gap:** Acceptable for a pilot and the 30-minute demo. Becomes a blocker when
reporting instrumentation health to VP-level stakeholders across the org.

---

### NFR-6 — Maintainability & Extensibility

**Requirement:** Phase boundaries must be typed and versionable; common extensions must
not require rewriting the orchestrator; vendor-specific code must be isolated.

| Sub-requirement | Detail | Status |
|---|---|---|
| **Schema-validated contracts** | Every cross-phase boundary uses Zod schemas in `types.ts`, not implicit JSON shapes. | **Met** |
| **Localized extension seams** | New gap kind, report type, or ADR rule touches only the owning module + schema. | **Met** — Design Decisions §5 |
| **Vendor isolation** | Mixpanel HTTP/API logic lives in `@instrument/mixpanel-client`, not the orchestrator core. | **Met** |

---

### NFR-7 — Portability & Compatibility

**Requirement:** Detection and generation should eventually support multiple app shapes;
v1 intentionally scopes to one.

**Current state:** Detection assumes a React "PageComponent" convention and a single
analytics-wrapper shape (`src/lib/analytics.ts`-style). There is no abstraction yet for
a second framework or a fundamentally different app architecture.

**Status: Gap** — correct scope for a single-customer pilot and an explicit non-goal for
v1 (see §3 below). Becomes a real requirement gap the moment a second, differently-shaped
app repo onboards. Mitigation path: AST-based detection (`ts-morph`) with the same output
schema (`ICoverageGap[]`).

---

### NFR-8 — Usability (Reviewer-Facing)

**Requirement:** A reviewer MUST be able to approve or reject instrumentation changes
from information present **on the GitHub diff itself**, without leaving GitHub to check
Mixpanel or open the standards doc.

**Why it matters:** This is the usability bar for the "reduce cognitive load" brief
criterion. If reviewers still need three tabs open, the tool hasn't earned merge-blocking
authority.

**Acceptance criteria:**
- Inline comments on change blocks include justification + Mixpanel link.
- Sticky comment summarizes phase outcomes and overall pass/fail.
- Phase timeline in the comment uses human-readable titles and subtitles.

**Status: Met** — inline comments carry justification + resolved Mixpanel link (Design
Decisions §3.12); phase descriptions in PR comment timeline.

---

## 3. Explicit Non-Goals (v1)

A staff FDE scopes a pilot as tightly as the requirements above, on purpose:

- Not a general PR review assistant (BugBot/security review are explicitly excluded by
  the brief, and this tool doesn't touch either).
- Not a multi-analytics-vendor platform yet — Mixpanel only, by design (Design Decisions
  §3.11 keeps the door open, doesn't walk through it).
- Not a replacement for human merge approval, under any circumstance.
- Not a historical analytics-health reporting tool — it is a per-PR gate, not a
  dashboard-of-dashboards.
- Not framework-agnostic — scoped to the customer's actual stack (React + a
  `src/lib/analytics.ts`-shaped wrapper), not a generic instrumentation engine.

---

## 4. What I'd require before calling this "customer-ready" beyond pilot

In priority order, the gate I'd actually enforce before proposing this to more than one
design-partner repo:

1. **Deterministic PII property-key denylist (NFR-2)** — don't rely on LLM judgment alone
   for a compliance-shaped guarantee.
2. **Eval set of labeled gap/fix fixtures** — score Code/Review Agent output quality over
   time, not just unit tests of the deterministic scaffolding around them.
3. **Per-run cost visibility (NFR-3)** — surfaced in the PR comment so a platform team can
   forecast spend before flipping this on org-wide.
4. **AST-based detection (`ts-morph`)** — once a second framework/shape needs support; the
   regex approach is the right amount of engineering for one design-partner repo, not for
   a generalized product.
