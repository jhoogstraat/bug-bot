import * as restate from "@restatedev/restate-sdk";
import type { CodingHarness } from "../../../coding/coding-harness.js";
import type { RepositoryConfig } from "../../../domain/repository.js";
import type { NormalizedBugTicket } from "../../../domain/ticket.js";
import type { TicketAnalysis } from "../../../domain/ticket-analysis.js";
import type {
  LocalGitWorkspaces,
  RepositoryWorkspace,
} from "../../../integrations/git/local-git-workspaces.js";

export class AnalysisTask {
  constructor(
    private readonly harness: CodingHarness,
    private readonly workspaces: LocalGitWorkspaces,
    private readonly actionableRepositoryId: string,
  ) {}

  async investigateTicket(
    ticket: NormalizedBugTicket,
    repository: RepositoryConfig,
    workspace: RepositoryWorkspace,
  ): Promise<{ analysis: TicketAnalysis; gate: ReturnType<typeof applyConfidenceGate> }> {
    const analysis = await this.harness.analyzeTask({
      ticket,
      workspacePath: workspace.path,
      repositoryId: repository.id,
      repositoryInstructions: repositoryInstructions(repository),
      limits: {
        maxAgentTurns: repository.limits.maxAgentTurns,
        maxExecutionMinutes: repository.limits.maxExecutionMinutes,
      },
    });

    if (analysis.issueKey !== ticket.key)
      throw new restate.TerminalError(`Analysis returned ${analysis.issueKey} for ${ticket.key}`);

    const gate = applyConfidenceGate(analysis, repository.id, this.actionableRepositoryId);
    await this.workspaces.writeInvestigationReport(
      workspace,
      ticket.key,
      analysisMarkdown(ticket, analysis, gate),
    );

    return { analysis, gate };
  }
}

export function applyConfidenceGate(
  analysis: TicketAnalysis,
  repositoryId: string,
  allowedRepositoryId: string,
): { actionable: boolean; reason: string } {
  const blockers: string[] = [];
  if (analysis.rootCauseConfidence !== "high") blockers.push("root-cause confidence is not High");
  if (analysis.proposedFixConfidence !== "high")
    blockers.push("proposed-fix confidence is not High");

  if (analysis.expectedFiles.length === 0 || analysis.observableBehavior.length === 0)
    blockers.push("the proposed change is not focused and verifiable");

  if (analysis.missingInformation.length > 0)
    blockers.push(`missing information: ${analysis.missingInformation.join("; ")}`);

  if (repositoryId !== allowedRepositoryId)
    blockers.push(
      `repository ${repositoryId} is outside the allowed ${allowedRepositoryId} repository`,
    );

  return blockers.length === 0
    ? {
        actionable: true,
        reason: "High-confidence, focused, verifiable fix contained in the allowed repository",
      }
    : { actionable: false, reason: blockers.join(". ") };
}

export function analysisMarkdown(
  ticket: NormalizedBugTicket,
  analysis: TicketAnalysis,
  decision: { actionable: boolean; reason: string },
): string {
  const list = (values: string[]): string =>
    values.length ? values.map((value) => `- ${value}`).join("\n") : "- None";

  return `# ${ticket.key}: ${ticket.summary}

## Verdict
- Root cause: ${analysis.rootCauseConfidence}
- Proposed fix: ${analysis.proposedFixConfidence}
- Decision: ${decision.actionable ? "Assign and implement yes" : "Assign and implement no"}
- Remaining uncertainty: ${analysis.missingInformation.join("; ") || "None"}

## Issue
${analysis.issue}

## Root cause
${analysis.rootCause}

## Proposed fix
${analysis.proposedFix}

## Scope
- Expected files or components: ${analysis.expectedFiles.join(", ") || "None identified"}
- Explicit non-goals: ${analysis.nonGoals.join("; ") || "None"}
- Observable behavior to verify: ${analysis.observableBehavior.join("; ") || "None identified"}

## Evidence
### Jira evidence
${list(analysis.jiraEvidence)}

### Repository evidence
${list(analysis.repositoryEvidence)}

### Reproduction evidence
${list(analysis.reproductionEvidence)}

## Complexity
- Rating: ${analysis.complexity.rating}
- Reasoning: ${analysis.complexity.reasoning}
- Main risks: ${analysis.complexity.risks.join("; ") || "None identified"}

## Missing information
${list(analysis.missingInformation)}
${decision.actionable ? "" : `\n## Human action required\n${analysis.humanRequest ?? decision.reason}\n`}`;
}

function repositoryInstructions(repository: RepositoryConfig) {
  return {
    buildCommands: repository.buildCommands,
    testCommands: repository.testCommands,
    lintCommands: repository.lintCommands,
  };
}
