# Architecture

Bug Bot runs one durable Restate workflow for one Jira bug and repository.

```mermaid
flowchart LR
    J["Fetch and normalize Jira bug"] --> I["Read-only investigation"]
    I --> G{"High-confidence focused fix?"}
    G -->|No| H["Human required"]
    G -->|Yes| C["Claim Jira ticket"]
    C --> X["Implement and commit"]
    X --> R{"Fresh read-only review"}
    R -->|Revise| X
    R -->|Re-investigate| H
    R -->|Accept| M["Push and open draft MR"]
    M --> D["Link MR and mark Jira ready to merge"]
```

## Owners

- [`workflow.ts`](../src/workflows/bugfix/workflow.ts) owns sequencing, retries, irreversible actions, and terminal results.
- [`analysis.ts`](../src/workflows/bugfix/tasks/analysis.ts) owns the deterministic confidence gate.
- [`local-git-workspaces.ts`](../src/integrations/git/local-git-workspaces.ts) owns repository isolation, path containment, Git execution, and cleanup.
- [`coding-harness.ts`](../src/coding/coding-harness.ts) defines the Codex/fake harness contract and structured results.
- The Jira and forge clients own their external boundaries. Forge access is exclusively through `gh` and `glab`.

## Invariants

- The repository URL must match a configured trusted prefix before cloning.
- Investigation and review use fresh read-only Codex sessions.
- Implementation and revision use the isolated workspace and never commit or push themselves.
- Git, not model output, is the source of truth for changed files.
- A patch must change at least one file, stay within the file limit, and report no validation failures.
- Review must accept before the branch is pushed and a draft merge request is opened.
- The bot may assign, transition, link, commit, and push, but it never merges.
- Restate journals every external or non-deterministic operation so retries do not repeat completed work.

## Security

Repository paths are containment-checked, symlinks are rejected at workspace boundaries, and commands use argument arrays. Codex receives neither Jira nor forge credentials. Configure Restate request identity outside private local networks.
