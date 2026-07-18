import * as restate from "@restatedev/restate-sdk";
import type {
  CodingHarness,
  HarnessReviewResult,
  HarnessRunResult,
} from "../../../coding/coding-harness.js";
import type { SonarFinding } from "../../../domain/ci.js";
import type { RepositoryConfig } from "../../../domain/repository.js";
import type { TicketAnalysis } from "../../../domain/ticket-analysis.js";
import type { NormalizedBugTicket } from "../../../domain/ticket.js";
import type {
  LocalGitWorkspaces,
  RepositoryWorkspace,
  WorkspaceChanges,
} from "../../../integrations/git/local-git-workspaces.js";
import { type BugFixWorkflowState, workspaceFromState } from "../workflow-state.js";

export class CodingTask {
  constructor(
    private readonly harness: CodingHarness,
    private readonly workspaces: LocalGitWorkspaces,
  ) {}

  async implementTicket(
    ticket: NormalizedBugTicket,
    repository: RepositoryConfig,
    workspace: RepositoryWorkspace,
    analysis: TicketAnalysis,
  ): Promise<HarnessRunResult> {
    const result = await this.harness.startTask({
      ticket,
      approvedAnalysis: analysis,
      workspacePath: workspace.path,
      repositoryInstructions: repositoryInstructions(repository),
      limits: {
        maxAgentTurns: repository.limits.maxAgentTurns,
        maxChangedFiles: repository.limits.maxChangedFiles,
        maxExecutionMinutes: repository.limits.maxExecutionMinutes,
      },
    });

    validateHarnessResult(result);
    return result;
  }

  async commitImplementation(
    workspace: RepositoryWorkspace,
    ticket: NormalizedBugTicket,
    repository: RepositoryConfig,
    result: HarnessRunResult,
  ): Promise<string> {
    return await this.commitValidatedPatch(
      workspace,
      repository,
      result,
      `fix(${ticket.key}): ${ticket.summary}`,
    );
  }

  async reviewPatch(
    state: BugFixWorkflowState,
    ticket: NormalizedBugTicket,
    sonarFindings: SonarFinding[],
  ): Promise<HarnessReviewResult & { state: BugFixWorkflowState }> {
    const workspace = workspaceFromState(state);
    const inspection = await this.workspaces.inspectChangesSinceBase(workspace);
    if (!state.analysis)
      throw new restate.TerminalError("Independent review requires the approved analysis");

    const review = await this.harness.review({
      ticket,
      analysis: state.analysis,
      workspacePath: workspace.path,
      diff: inspection.diff,
      validationSummary: "Defect reproduction and relevant local checks completed",
      ciStatus: "not started; review is required before publication",
      sonarFindings,
    });

    return {
      ...review,
      state: {
        ...state,
        statusDetail: review.summary,
      },
    };
  }

  async revisePatch(
    state: BugFixWorkflowState,
    ticket: NormalizedBugTicket,
    repository: RepositoryConfig,
    review: HarnessReviewResult,
  ): Promise<BugFixWorkflowState> {
    const workspace = workspaceFromState(state);
    const sessionId = state.harness?.sessionId;
    if (!sessionId)
      throw new restate.TerminalError(
        "Review feedback cannot be addressed without the implementer session",
      );

    if (state.reviewAttempt >= state.maxRepairAttempts)
      throw new restate.TerminalError("Review revision limit reached");

    const before = await this.workspaces.inspectChangesSinceBase(workspace);
    const result = await this.harness.reviseTask(sessionId, {
      workspacePath: workspace.path,
      ticketSummary: ticketSummary(ticket),
      diffSummary: before.diffSummary,
      review,
    });

    const commitSha = await this.commitValidatedPatch(
      workspace,
      repository,
      result,
      `fix(${ticket.key}): repair review findings`,
    );

    return {
      ...state,
      state: "REVIEWING",
      reviewAttempt: state.reviewAttempt + 1,
      currentCommitSha: commitSha,
      statusDetail: "Review findings addressed; awaiting a fresh independent review",
    };
  }

  private async commitValidatedPatch(
    workspace: RepositoryWorkspace,
    repository: RepositoryConfig,
    result: HarnessRunResult,
    message: string,
  ): Promise<string> {
    validateHarnessResult(result);
    validatePatch(await this.workspaces.inspectPendingChanges(workspace), repository);
    return await this.workspaces.commitChanges(workspace, message);
  }
}

function validateHarnessResult(result: HarnessRunResult): void {
  if (result.status === "human_input_required")
    throw new restate.TerminalError(result.humanInputRequest ?? result.summary);

  if (result.status !== "completed") throw new restate.TerminalError(result.summary);
  if (!result.validation.succeeded)
    throw new restate.TerminalError(result.validation.failures.join("; "));
}

function validatePatch(inspection: WorkspaceChanges, repository: RepositoryConfig): void {
  if (inspection.changedFiles.length === 0)
    throw new restate.TerminalError("Harness completed without changing files");

  if (inspection.changedFiles.length > repository.limits.maxChangedFiles)
    throw new restate.TerminalError(
      `Patch changed ${inspection.changedFiles.length} files; limit is ${repository.limits.maxChangedFiles}`,
    );
}

function repositoryInstructions(repository: RepositoryConfig) {
  return {
    buildCommands: repository.buildCommands,
    testCommands: repository.testCommands,
    lintCommands: repository.lintCommands,
  };
}

function ticketSummary(ticket: NormalizedBugTicket) {
  return {
    key: ticket.key,
    summary: ticket.summary,
    ...(ticket.expectedBehavior ? { expectedBehavior: ticket.expectedBehavior } : {}),
    ...(ticket.actualBehavior ? { actualBehavior: ticket.actualBehavior } : {}),
  };
}
