import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TicketAnalysis } from "../domain/ticket-analysis.js";
import type {
  AnalyzeHarnessTaskInput,
  CodingHarness,
  ContinueHarnessTaskInput,
  HarnessReviewResult,
  HarnessRunResult,
  ReviewHarnessTaskInput,
  ReviseHarnessTaskInput,
  StartHarnessTaskInput,
} from "./coding-harness.js";

export class FakeCodingHarness implements CodingHarness {
  private ciRepairCount = 0;
  private revisionCount = 0;

  async analyzeTask(input: AnalyzeHarnessTaskInput): Promise<TicketAnalysis> {
    return {
      issueKey: input.ticket.key,
      rootCauseConfidence: "high",
      proposedFixConfidence: "high",
      rootCause: "Simulated root cause",
      proposedFix: "Create one focused fixture change",
      expectedFiles: [`.bug-bot/${input.ticket.key}.txt`],
      nonGoals: ["Unrelated changes"],
      observableBehavior: ["Focused fixture exists"],
      repositoryEvidence: ["Fake harness fixture"],
      reproductionEvidence: ["Fake reproduction"],
      missingInformation: [],
    };
  }

  async startTask(input: StartHarnessTaskInput): Promise<HarnessRunResult> {
    const relative = `.bug-bot/${input.ticket.key}.txt`;
    await mkdir(join(input.workspacePath, ".bug-bot"), { recursive: true });
    await writeFile(
      join(input.workspacePath, relative),
      `Simulated focused fix for ${input.ticket.key}\n`,
      "utf8",
    );

    return {
      sessionId: `fake-session-${input.ticket.key}`,
      status: "completed",
      summary: "Fake harness produced a focused change",
      validation: { commandsRun: ["fake:test"], failures: [] },
    };
  }

  async reviseTask(sessionId: string, input: ReviseHarnessTaskInput): Promise<HarnessRunResult> {
    const relative = `.bug-bot/review-revision-${++this.revisionCount}.txt`;
    await writeFile(join(input.workspacePath, relative), "Simulated review revision\n", "utf8");
    return {
      sessionId,
      status: "completed",
      summary: "Fake review findings addressed",
      validation: { commandsRun: ["fake:test"], failures: [] },
    };
  }

  async continueTask(
    sessionId: string,
    input: ContinueHarnessTaskInput,
  ): Promise<HarnessRunResult> {
    const relative = `.bug-bot/ci-repair-${++this.ciRepairCount}.txt`;
    await writeFile(join(input.workspacePath, relative), "Simulated CI repair\n", "utf8");
    return {
      sessionId,
      status: "completed",
      summary: "Fake harness addressed supplied CI evidence",
      validation: { commandsRun: ["fake:test"], failures: [] },
    };
  }

  async review(_input: ReviewHarnessTaskInput): Promise<HarnessReviewResult> {
    return {
      verdict: "accept",
      summary: "Fake independent review accepted the patch",
      findings: [],
    };
  }
}
