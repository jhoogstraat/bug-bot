import { NormalizedBugTicket } from "../domain/ticket.js";
import type { ReviewHarnessTaskInput } from "./coding-harness.js";
import type { ContinueHarnessTaskInput } from "./coding-harness.js";

export function buildReviewContext(input: ReviewHarnessTaskInput): string {
  return JSON.stringify({
    ticket: input.ticket,
    diff: input.diff.slice(0, 50_000),
    validationSummary: input.validationSummary.slice(0, 4_000),
    ciStatus: input.ciStatus,
    sonarFindings: input.sonarFindings.slice(0, 20),
    analysis: input.analysis,
  });
}

export function buildCiContext(input: ContinueHarnessTaskInput): string {
  return JSON.stringify({
    ticket: input.ticketSummary,
    currentCommitSha: input.currentCommitSha,
    diffSummary: input.diffSummary.slice(0, 4_000),
    failure: input.failure,
  });
}

export function buildTicketContext(input: NormalizedBugTicket): string {
  return JSON.stringify({ ticket: input });
}
