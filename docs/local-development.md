# Local development

## Requirements

- Bun 1.3 or newer
- Git
- Docker or Apple container for the Restate replay test
- Authenticated `gh` and/or `glab` for the submitted forge
- Codex authentication when `coding.provider = "codex"`

## Setup

```bash
cp bug-bot.example.toml bug-bot.toml
cp .env.example .env
bun install
bun run check
```

`bug-bot.toml` contains non-secret application settings grouped by component. Bun parses it
natively and the service validates the complete file before startup. Fake Jira, CI feedback, and
coding harnesses are the defaults. Set `jira.mode = "real"`, `ci.provider = "jenkins"`, or
`coding.provider = "codex"` to enable the corresponding integration. Every repository URL must
start with one of the entries in `workspace.trusted_repository_url_prefixes`.

The tables have the following responsibilities:

- `server`: HTTP port exposed to Restate.
- `restate`: request identity verification keys.
- `jira`: fake or real Jira selection and the real Jira base URL.
- `coding`: fake or Codex harness selection and its timeout.
- `workspace`: local workspace root and trusted repository URL prefixes.
- `ci`: fake or Jenkins feedback selection, check name, and polling policy.
- `limits`: changed-file and repair budgets enforced by the workflow.

Keep secrets in `.env`: real Jira requires `JIRA_TOKEN`; Jenkins requires `JENKINS_USERNAME` and
`JENKINS_API_KEY`. Set `BUG_BOT_CONFIG` to load a file other than `./bug-bot.toml`. Relative paths
are resolved from the current working directory. Configuration is immutable after startup, and
unknown or invalid fields stop the service with the failing path identified.

## Run

```bash
docker compose up -d restate
bun run dev
```

Register the Restate endpoint:

```bash
curl -X POST http://localhost:9070/deployments \
  -H 'content-type: application/json' \
  -d '{"uri":"http://host.docker.internal:9080"}'
```

`BugFixWorkflow` accepts `{ issueKey, forge, url }`. The bundled fake Jira contains `DEMO-1`; the repository must still be a real Git remote because workspace and forge operations are intentionally not faked.

Set `restate.identity_keys` to an array of `publickeyv1_*` values when the endpoint is not restricted
to a private network.

## Verification

```bash
bun run check
bun run test:restate
```
