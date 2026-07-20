import { z } from "zod";

export const ticketAnalysisSchema = z.object({
  issueKey: z.string(),
  rootCauseConfidence: z.enum(["high", "medium", "low"]),
  proposedFixConfidence: z.enum(["high", "medium", "low"]),
  rootCause: z.string().max(12_000),
  proposedFix: z.string().max(12_000),
  expectedFiles: z.array(z.string()).max(50),
  nonGoals: z.array(z.string()).max(50),
  observableBehavior: z.array(z.string()).max(50),
  repositoryEvidence: z.array(z.string()).max(100),
  reproductionEvidence: z.array(z.string()).max(100),
  missingInformation: z.array(z.string()).max(50),
});

export type TicketAnalysis = z.infer<typeof ticketAnalysisSchema>;
