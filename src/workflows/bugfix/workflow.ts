import * as restate from "@restatedev/restate-sdk";
import { analysisMarkdown, applyConfidenceGate } from "./tasks/analysis.js";
import { dependencies } from "./dependencies.js";
import type { CompactCiFailure, SonarFinding } from "../../domain/ci.js";
import type { TicketAnalysis } from "../../domain/ticket-analysis.js";
import type { HarnessReviewResult, HarnessRunResult } from "../../coding/coding-harness.js";
import type { MergeRequest } from "../../domain/merge-request.js";
import type { RepositoryConfig } from "../../domain/repository.js";
import type { NormalizedBugTicket } from "../../domain/ticket.js";
import {
  done,
  humanRequired,
  published,
  reviewReady,
  type BugFixWorkflowState,
} from "./workflow-state.js";
import { normalizeJiraIssue } from "../../integrations/jira/jira-normalizer.js";
import type {
  RepositoryWorkspace,
  WorkspaceChanges,
} from "../../integrations/git/local-git-workspaces.js";

const { actionableRepositoryId, codingHarness, gitlab, jira, resolveRepository, workspaces } =
  dependencies;

export const BugFixWorkflow = restate.workflow({
  name: "BugFixWorkflow",
  options: {
    inactivityTimeout: 60_000,
  },
  handlers: {
    run: async (ctx: restate.WorkflowContext, issueKey: string) => {
      const runId = workflowId(issueKey);

      try {
        const ticket = await ctx.run("load-normalized-ticket", async () =>
          normalizeJiraIssue(await jira.getIssue(issueKey)),
        );

        const repository = resolveRepository(ticket);

        const investigationWorkspace = await ctx.run(
          "create-workspace",
          () =>
            workspaces.create({
              workflowId: runId,
              issueKey: ticket.key,
              shortSlug: ticket.summary,
              repository,
            }),
          { maxRetryAttempts: 3 },
        );

        const investigation = await ctx.run(
          "investigate-ticket",
          () => investigateTicket(ticket, repository, investigationWorkspace),
          { maxRetryAttempts: 2 },
        );

        if (!investigation.gate.actionable) {
          const blockedState = humanRequired(
            initialState(
              runId,
              1,
              ticket,
              repository,
              investigationWorkspace,
              investigation.analysis,
            ),
            investigation.gate.reason,
          );

          return workflowResult(runId, blockedState);
        }

        await ctx.run("claim-jira-ticket", () => jira.claimIssue(ticket.key), {
          maxRetryAttempts: 3,
        });

        const workspace = await ctx.run(
          "activate-focused-branch",
          () => workspaces.activateBranch(investigationWorkspace),
          { maxRetryAttempts: 2 },
        );

        const harnessResult = await ctx.run(
          "start-codex",
          () => startHarness(ticket, repository, workspace, investigation.analysis),
          { maxRetryAttempts: 2 },
        );

        const commitSha = await ctx.run(
          "validate-and-commit",
          () => validateAndCommit(workspace, ticket, repository, harnessResult),
          { maxRetryAttempts: 1 },
        );

        let reviewState = implementationState(
          runId,
          1,
          ticket,
          repository,
          workspace,
          investigation.analysis,
          harnessResult,
          commitSha,
        );

        for (;;) {
          const review = await ctx.run(
            `independent-review-${reviewState.reviewAttempt}`,
            () => reviewPatch(reviewState, ticket, []),
            { maxRetryAttempts: 2 },
          );

          if (review.verdict === "accept") {
            reviewState = reviewReady(review.state, review.summary);
            break;
          }

          if (review.verdict === "re-investigate") {
            reviewState = humanRequired(
              review.state,
              `Review invalidated the analysis: ${review.summary}`,
            );

            return workflowResult(runId, reviewState);
          }

          reviewState = await ctx.run(
            `address-review-${reviewState.reviewAttempt + 1}`,
            () => revisePatch(review.state, ticket, repository, review),
            { maxRetryAttempts: 1 },
          );
        }

        await ctx.run("push-branch", () => workspaces.pushBranch(workspaceFromState(reviewState)), {
          maxRetryAttempts: 3,
        });

        const mergeRequest = await ctx.run(
          "create-draft-merge-request",
          () => createMergeRequest(runId, ticket, repository, reviewState, harnessResult),
          { maxRetryAttempts: 3 },
        );

        const readyState = reviewReady(
          published(reviewState, mergeRequest),
          "Draft merge request created; merge remains a human action",
        );

        await ctx.run("jira-link-merge-request", () => linkMergeRequestInJira(readyState), {
          maxRetryAttempts: 3,
        });

        await ctx.run("jira-ready-to-merge", () => markJiraReadyToMerge(readyState), {
          maxRetryAttempts: 3,
        });

        return workflowResult(
          runId,
          done(readyState, "Ready to merge; merge remains a human action"),
        );
      } catch (error) {
        if (error instanceof restate.CancelledError) throw error;
        if (!(error instanceof restate.TerminalError)) throw error;

        const detail = error instanceof Error ? error.message : String(error);
        return workflowResult(runId, createFailureState(runId, issueKey, detail));
      }
    },
  },
});

async function investigateTicket(
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  workspace: RepositoryWorkspace,
): Promise<{ analysis: TicketAnalysis; gate: ReturnType<typeof applyConfidenceGate> }> {
  const analysis = await codingHarness.analyzeTask({
    ticket,
    workspacePath: workspace.path,
    repositoryId: repository.id,
    repositoryInstructions: {
      buildCommands: repository.buildCommands,
      testCommands: repository.testCommands,
      lintCommands: repository.lintCommands,
    },
    limits: {
      maxAgentTurns: repository.limits.maxAgentTurns,
      maxExecutionMinutes: repository.limits.maxExecutionMinutes,
    },
  });

  if (analysis.issueKey !== ticket.key)
    throw new restate.TerminalError(`Analysis returned ${analysis.issueKey} for ${ticket.key}`);

  const gate = applyConfidenceGate(analysis, repository.id, actionableRepositoryId);
  await workspaces.writeInvestigationReport(
    workspace,
    ticket.key,
    analysisMarkdown(ticket, analysis, gate),
  );

  return { analysis, gate };
}

async function startHarness(
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  workspace: RepositoryWorkspace,
  analysis: TicketAnalysis,
): Promise<HarnessRunResult> {
  const result = await codingHarness.startTask({
    ticket,
    approvedAnalysis: analysis,
    workspacePath: workspace.path,
    repositoryInstructions: {
      buildCommands: repository.buildCommands,
      testCommands: repository.testCommands,
      lintCommands: repository.lintCommands,
    },
    limits: {
      maxAgentTurns: repository.limits.maxAgentTurns,
      maxChangedFiles: repository.limits.maxChangedFiles,
      maxExecutionMinutes: repository.limits.maxExecutionMinutes,
    },
  });

  validateHarnessResult(result);
  return result;
}

async function validateAndCommit(
  workspace: RepositoryWorkspace,
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  result: HarnessRunResult,
): Promise<string> {
  validateHarnessResult(result);
  validatePatch(await workspaces.inspectPendingChanges(workspace), repository);
  return await workspaces.commitChanges(workspace, `fix(${ticket.key}): ${ticket.summary}`);
}

async function createMergeRequest(
  runId: string,
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  state: BugFixWorkflowState,
  result: HarnessRunResult,
): Promise<MergeRequest> {
  return await gitlab.createDraftMergeRequest({
    idempotencyKey: runId,
    projectId: repository.gitlabProjectId,
    sourceBranch: workspaceFromState(state).branchName,
    targetBranch: repository.defaultBranch,
    title: `${ticket.key}: ${ticket.summary}`,
    description: mergeRequestDescription(ticket, result),
    draft: true,
    assignToCurrentUser: true,
    labels: ["LHIND"],
  });
}

async function reviewPatch(
  state: BugFixWorkflowState,
  ticket: NormalizedBugTicket,
  sonarFindings: SonarFinding[],
): Promise<HarnessReviewResult & { state: BugFixWorkflowState }> {
  const workspace = workspaceFromState(state);
  const inspection = await workspaces.inspectChangesSinceBase(workspace);
  if (!state.analysis)
    throw new restate.TerminalError("Independent review requires the approved analysis");

  const review = await codingHarness.review({
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

async function revisePatch(
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

  const before = await workspaces.inspectChangesSinceBase(workspace);
  const result = await codingHarness.reviseTask(sessionId, {
    workspacePath: workspace.path,
    ticketSummary: ticketSummary(ticket),
    diffSummary: before.diffSummary,
    review,
  });

  const commitSha = await validateAndCommitRepair(state, ticket, repository, result);

  return {
    ...state,
    state: "REVIEWING",
    reviewAttempt: state.reviewAttempt + 1,
    currentCommitSha: commitSha,
    statusDetail: "Review findings addressed; awaiting a fresh independent review",
  };
}

async function validateAndCommitRepair(
  state: BugFixWorkflowState,
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  result: HarnessRunResult,
): Promise<string> {
  const workspace = workspaceFromState(state);
  validateHarnessResult(result);
  validatePatch(await workspaces.inspectPendingChanges(workspace), repository);
  return await workspaces.commitChanges(workspace, `fix(${ticket.key}): repair review findings`);
}

async function linkMergeRequestInJira(state: BugFixWorkflowState): Promise<void> {
  if (!state.mergeRequest)
    throw new restate.TerminalError("Only an accepted review can be handed off");

  await jira.ensureMergeRequestLink(state.issueKey, state.mergeRequest.url);
}

async function markJiraReadyToMerge(state: BugFixWorkflowState): Promise<void> {
  if (!state.mergeRequest)
    throw new restate.TerminalError("Only an accepted review can be handed off");

  await jira.ensureReadyToMerge(state.issueKey);
}

function initialState(
  runId: string,
  generation: number,
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  workspace: RepositoryWorkspace,
  analysis: TicketAnalysis,
): BugFixWorkflowState {
  return {
    runId,
    issueKey: ticket.key,
    generation,
    repository: {
      id: repository.id,
      cloneUrl: repository.cloneUrl,
      defaultBranch: repository.defaultBranch,
    },
    branchName: workspace.branchName,
    baseCommitSha: workspace.baseCommitSha,
    harness: { provider: "codex", workspacePath: workspace.path },
    analysis,
    state: "REVIEWING",
    repairAttempt: 0,
    reviewAttempt: 0,
    maxRepairAttempts: repository.limits.maxRepairAttempts,
  };
}

function implementationState(
  runId: string,
  generation: number,
  ticket: NormalizedBugTicket,
  repository: RepositoryConfig,
  workspace: RepositoryWorkspace,
  analysis: TicketAnalysis,
  result: HarnessRunResult,
  commitSha: string,
): BugFixWorkflowState {
  return {
    ...initialState(runId, generation, ticket, repository, workspace, analysis),
    currentCommitSha: commitSha,
    harness: { provider: "codex", sessionId: result.sessionId, workspacePath: workspace.path },
  };
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

function ticketSummary(ticket: NormalizedBugTicket) {
  return {
    key: ticket.key,
    summary: ticket.summary,
    ...(ticket.expectedBehavior ? { expectedBehavior: ticket.expectedBehavior } : {}),
    ...(ticket.actualBehavior ? { actualBehavior: ticket.actualBehavior } : {}),
  };
}

function workspaceFromState(state: BugFixWorkflowState): RepositoryWorkspace {
  const path = state.harness?.workspacePath;
  if (!path || !state.branchName || !state.baseCommitSha)
    throw new restate.TerminalError("Workflow does not contain a recoverable workspace");

  return { path, branchName: state.branchName, baseCommitSha: state.baseCommitSha };
}

function mergeRequestDescription(ticket: NormalizedBugTicket, result: HarnessRunResult): string {
  return `## What\n${result.summary}\n\n## Why\n${result.rootCause ?? "See ticket context"}\n\n## How\nFocused automated patch for ${ticket.key}.\n\n## Verification\n${result.validation.commandsRun.join("\n")}\n\n## Scope\nNo unrelated changes.\n\nFixes ${ticket.key}`;
}

export type RepairDecision = { action: "repair" } | { action: "human_required"; reason: string };

export function decideRepair(
  state: BugFixWorkflowState,
  failure: CompactCiFailure,
  currentCommitSha: string,
): RepairDecision {
  if (failure.category === "infrastructure" || failure.category === "timeout") {
    return {
      action: "human_required",
      reason: `CI failure is ${failure.category}; product code will not be changed`,
    };
  }

  if (state.repairAttempt >= state.maxRepairAttempts)
    return { action: "human_required", reason: "Maximum repair attempts reached" };

  if (
    state.lastFailureFingerprint === failure.fingerprint &&
    state.lastCommitAtFailure === currentCommitSha
  ) {
    return {
      action: "human_required",
      reason: "The same failure repeated without a meaningful code change",
    };
  }

  return { action: "repair" };
}

function workflowResult(runId: string, state: BugFixWorkflowState) {
  return {
    runId,
    state: state.state,
    ...(state.statusDetail ? { detail: state.statusDetail } : {}),
  };
}

function createFailureState(runId: string, issueKey: string, detail: string): BugFixWorkflowState {
  return {
    runId,
    issueKey,
    generation: 1,
    repository: { id: "unresolved", cloneUrl: "", defaultBranch: "" },
    state: "FAILED",
    repairAttempt: 0,
    reviewAttempt: 0,
    maxRepairAttempts: 0,
    statusDetail: detail,
  };
}

export const workflowId = (issueKey: string): string => `bugfix/${issueKey}`;
