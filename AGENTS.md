# Repository Guidelines

## Project Overview

Bug Bot is a Bun/TypeScript service that turns a Jira bug into a reviewed draft pull/merge request. Restate provides durable execution and retries; deterministic TypeScript owns validation, policy, and side effects; Codex or a fake harness performs bounded investigation and implementation. The workflow always leaves the final merge to a human.

## Engineering practices
We're a startup. You're probably used to writing enterprise code - code that tries to handle every possible edge case and has fallbacks for everything. 
That's not how we do things around here: our number one rule is to keep things simple. We handle ONLY the most important cases.

We try to only add new functionality that is small (that is, simple and few lines of code or absolutely necessary. If a change is not small or absolutely necessary, don't make it.

Humans are the architects that decide the the software design. Same goes for contracts.

### Typing external payloads:
• Define payload types from external systems in plain TypeScript `*.types.ts`ts files.
• Parse unknown external data with Zod at the boundary where it enters the app. Parsing should either return typed data or throw.

## Mandatory Skill

Always invoke and follow the `maintainable-typescript` skill for TypeScript planning, implementation, refactoring, review, and cleanup. Read its `SKILL.md` before acting and load the task-relevant doctrine it routes to. Apply its portable maintainability rules unless this repository explicitly adopts its full house stack; do not introduce that stack by assumption.

## Architecture & Data Flow

Production code follows ports-and-adapters with a durable workflow as the application core:

1. `src/app/server.ts` loads validated environment settings and exposes `BugFixWorkflow` through Restate.
2. `src/workflow/workflow.ts` validates `{ issueKey, forge, url }`, fetches and normalizes Jira data, and creates an isolated Git workspace.
3. A `CodingHarness` performs read-only analysis. `src/workflow/workflow.ts` applies the confidence gate before Jira or repository mutation.
4. The workflow claims Jira, creates an `agent/...` branch, implements and validates a bounded patch, commits it, and requests a fresh independent review.
5. The selected forge adapter pushes the branch and idempotently creates a draft GitHub PR or GitLab MR.
6. Restate polls CI for the exact pushed SHA. Failed Jenkins builds may feed bounded, sanitized evidence back into the same implementation session; every repair receives another independent review.
7. Passing CI moves Jira to `Ready to merge`. Unsafe, uncertain, canceled, or exhausted paths return `HUMAN_REQUIRED`; the service never merges.

Keep transport and integration adapters thin. Product policy and sequencing belong in `src/workflow/`; external clients own Jira, Git, forge, and Jenkins side effects. Restate owns durable ordering, retry identity, and sleeps; Git/workspace metadata owns repository state. There is no application database or global state store.

## Key Directories

- `src/app/`: server bootstrap and Zod-validated environment boundary.
- `src/workflow/`: durable orchestration, dependency composition, and confidence policy.
- `src/domain/`: framework-independent ticket, analysis, and CI contracts.
- `src/coding/`: coding-harness port, Codex/fake adapters, structured schemas, and prompts.
- `src/integrations/`: Jira, local Git, GitHub/GitLab CLI, and Jenkins adapters. `sonarqube/` is currently empty; do not assume an implementation exists.
- `test/`: flat Bun test suite, including the opt-in Restate replay integration test.
- `docs/`: architecture and local-development guidance.

## Code Conventions & Common Patterns

- Use strict TypeScript and ESM. Preserve `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and unknown catch variables.
- Format with Prettier: 2-space indentation, LF endings, final newline, and 100-column width. Let typed ESLint enforce local layout and safety rules.
- Use PascalCase for classes/interfaces, camelCase for functions and values, and descriptive suffixes such as `*Input`, `*Result`, `*Dto`, `*Client`, `*Harness`, and `*Schema`.
- Validate trust boundaries with Zod: environment, workflow input/output, external JSON, and coding-agent structured output. Use TypeScript interfaces for internal records that do not need runtime parsing.
- Prefer async/await and bounded operations. Network calls and subprocesses need timeouts and output limits. Use `Promise.all` only for independent work. In workflows, wrap side effects in stable, kebab-case `ctx.run` steps and use `ctx.sleep`, not process-local timers.
- Treat expected inability to proceed as `HUMAN_REQUIRED`; use `restate.TerminalError` for permanent workflow contract/security violations; let retryable adapter failures throw actionable `Error`s. Preserve redaction and size bounds on external output.
- Inject external boundaries through interfaces, constructors, or narrow function parameters. `src/workflow/dependencies.ts` is the manual composition root for fake/real modes. Extend existing ports instead of importing integrations directly into policy code.
- Keep coding agents isolated from credentials and external systems. The workflow—not the harness—owns Jira transitions, Git commits/pushes, MR creation, and CI retrieval.
- Make irreversible operations idempotent and preserve configured repository allow-lists, path containment, changed-file limits, repair budgets, and independent-review gates.

## Runtime/Tooling Preferences

- Do not substitute npm, pnpm, Yarn, Jest, Vitest, or Node-based script execution.
- The project emits ES2023 NodeNext modules and source maps under `dist/`.
- Local replay testing requires Docker or Apple Container. Real forge access requires authenticated `gh` and/or `glab`; Codex mode requires Codex authentication.
- Copy `bug-bot.example.toml` to the ignored `bug-bot.toml` and `.env.example` to `.env`; never commit `bug-bot.toml`, `.env`, `.bug-bot-workspaces/`, `dist/`, logs, or coverage output.
- No hosted CI workflow is committed. Treat `bun run check` as the repository quality gate.

## Testing & QA

Tests use Bun's built-in `bun:test` API and live in `test/*.test.ts`. Add focused tests beside the existing flat suite using `*.test.ts`; use `*.integration.test.ts` for runtime integration cases.

Prefer observable contracts over implementation choreography: returned states, exact adapter arguments, filesystem/Git results, idempotency, sanitization, and rejection behavior. Inject or fake external boundaries (fetch, CLI, Codex, Jira, forge, CI), but use real internal wiring where practical. Existing workspace tests use disposable real Git repositories; always clean temporary state in `afterEach`/`afterAll`.

`test/restate-replay.integration.test.ts` exercises production workflow wiring with a disposable Restate runtime and is gated by `RUN_RESTATE_TESTS=1`; use the package scripts rather than setting flags manually. TypeScript compilation includes tests. No coverage command or threshold is configured, so do not claim coverage guarantees. Before finishing a change, run the smallest relevant test and then `bun run check`; run the Restate integration command when durable replay or workflow sequencing changes.
