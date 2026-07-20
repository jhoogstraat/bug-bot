import { describe, expect, it } from "bun:test";
import type { TicketAnalysis } from "../src/domain/ticket-analysis.js";
import { applyConfidenceGate } from "../src/workflow/tasks/analysis.js";

const complete: TicketAnalysis = {
  issueKey: "ABC-1",
  rootCauseConfidence: "high",
  proposedFixConfidence: "high",
  rootCause: "Cause",
  proposedFix: "Fix",
  expectedFiles: ["src/a.ts"],
  nonGoals: [],
  observableBehavior: ["Regression passes"],
  repositoryEvidence: ["src/a.ts:1"],
  reproductionEvidence: ["test fails"],
  missingInformation: [],
};

describe("confidence gate", () => {
  it("accepts a high-confidence focused fix", () => {
    expect(applyConfidenceGate(complete).actionable).toBe(true);
  });

  it("blocks before Jira mutation when evidence or repository scope is incomplete", () => {
    const decision = applyConfidenceGate({
      ...complete,
      rootCauseConfidence: "medium",
      reproductionEvidence: [],
      missingInformation: ["production log"],
    });

    expect(decision.actionable).toBe(false);
    expect(decision.reason).toContain("root-cause confidence");
    expect(decision.reason).toContain("evidence is missing");
    expect(decision.reason).toContain("production log");
  });
});
