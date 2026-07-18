export type Confidence = "high" | "medium" | "low";

export interface TicketAnalysis {
  issueKey: string;
  summary: string;
  rootCauseConfidence: Confidence;
  proposedFixConfidence: Confidence;
  issue: string;
  rootCause: string;
  proposedFix: string;
  expectedFiles: string[];
  nonGoals: string[];
  observableBehavior: string[];
  jiraEvidence: string[];
  repositoryEvidence: string[];
  reproductionEvidence: string[];
  complexity: { rating: "low" | "medium" | "high"; reasoning: string; risks: string[] };
  missingInformation: string[];
  humanRequest?: string;
}
