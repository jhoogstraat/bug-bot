import { z } from "zod";
import type { TicketAnalysis } from "../domain/ticket-analysis.js";
import type { NormalizedBugTicket } from "../domain/ticket.js";

export const harnessRunOutputSchema = z.object({
  status: z.enum(["completed", "failed"]),
  summary: z.string().max(8_000),
  validation: z.object({
    commandsRun: z.array(z.string()).max(50),
    failures: z.array(z.string().max(2_000)).max(20),
  }),
});

export type HarnessRunResult = z.infer<typeof harnessRunOutputSchema> & { sessionId: string };

export const harnessReviewResultSchema = z.object({
  verdict: z.enum(["accept", "revise", "re-investigate"]),
  summary: z.string().max(8_000),
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocking", "important"]),
        location: z.string().optional(),
        problem: z.string(),
        correction: z.string(),
      }),
    )
    .max(30),
});

export type HarnessReviewResult = z.infer<typeof harnessReviewResultSchema>;

export interface StartHarnessTaskInput {
  ticket: NormalizedBugTicket;
  approvedAnalysis: TicketAnalysis;
  workspacePath: string;
}

export interface AnalyzeHarnessTaskInput {
  ticket: NormalizedBugTicket;
  workspacePath: string;
}

export interface ReviseHarnessTaskInput {
  workspacePath: string;
  ticketSummary: Pick<
    NormalizedBugTicket,
    "key" | "summary" | "expectedBehavior" | "actualBehavior"
  >;
  diffSummary: string;
  review: HarnessReviewResult;
}

export interface ReviewHarnessTaskInput {
  ticket: NormalizedBugTicket;
  analysis: TicketAnalysis;
  workspacePath: string;
  diff: string;
}

export interface CodingHarness {
  analyzeTask(input: AnalyzeHarnessTaskInput): Promise<TicketAnalysis>;
  startTask(input: StartHarnessTaskInput): Promise<HarnessRunResult>;
  reviseTask(sessionId: string, input: ReviseHarnessTaskInput): Promise<HarnessRunResult>;
  review(input: ReviewHarnessTaskInput): Promise<HarnessReviewResult>;
}
