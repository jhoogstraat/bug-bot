# Local development

## Requirements

- Bun 1.3 or newer
- Git
- Docker or Apple container for the Restate replay test
- Authenticated `gh` and/or `glab` for the submitted forge
- Codex authentication when `HARNESS_MODE=codex`

## Setup

```bash
cp .env.example .env
bun install
bun run check
```

Fake Jira and the fake coding harness are the defaults. Set `ADAPTER_MODE=real` with `JIRA_BASE_URL` and `JIRA_TOKEN` for Jira, or `HARNESS_MODE=codex` for Codex. Every repository URL must start with one of the comma-separated `TRUSTED_REPOSITORY_URL_PREFIXES`.

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

Set `RESTATE_IDENTITY_KEYS` to comma-separated `publickeyv1_*` values when the endpoint is not restricted to a private network.

## Verification

```bash
bun run check
bun run test:restate
# On macOS with Apple container:
bun run test:restate:apple
```
