import type { TicketAnalysis } from "../../domain/ticket-analysis.js";

export function applyConfidenceGate(analysis: TicketAnalysis): {
  actionable: boolean;
  reason: string;
} {
  const blockers: string[] = [];
  if (analysis.rootCauseConfidence !== "high") blockers.push("root-cause confidence is not High");
  if (analysis.proposedFixConfidence !== "high")
    blockers.push("proposed-fix confidence is not High");

  if (analysis.expectedFiles.length === 0 || analysis.observableBehavior.length === 0)
    blockers.push("the proposed change is not focused and verifiable");

  if (analysis.repositoryEvidence.length === 0 || analysis.reproductionEvidence.length === 0)
    blockers.push("repository or reproduction evidence is missing");

  if (analysis.missingInformation.length > 0)
    blockers.push(`missing information: ${analysis.missingInformation.join("; ")}`);

  return blockers.length === 0
    ? {
        actionable: true,
        reason: "High-confidence, focused, verifiable fix",
      }
    : { actionable: false, reason: blockers.join(". ") };
}
