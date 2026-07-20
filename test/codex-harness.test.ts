import { describe, expect, it } from "bun:test";
import type { RunResult, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import type { TicketAnalysis } from "../src/domain/ticket-analysis.js";
import type { NormalizedBugTicket } from "../src/domain/ticket.js";
import { CodexHarness, type CodexClient } from "../src/coding/codex-coding-harness.js";

const ticket: NormalizedBugTicket = {
  key: "ABC-1",
  summary: "Fix the fixture",
  reproductionSteps: [],
  status: "Open",
  affectedVersions: [],
  statusHistory: [],
  labels: [],
  relevantComments: [],
  linkedIssues: [],
  attachments: [],
};

const analysis: TicketAnalysis = {
  issueKey: ticket.key,
  rootCauseConfidence: "high",
  proposedFixConfidence: "high",
  rootCause: "Incorrect fixture",
  proposedFix: "Correct the fixture",
  expectedFiles: ["fixture.ts"],
  nonGoals: [],
  observableBehavior: ["Fixture passes"],
  repositoryEvidence: [],
  reproductionEvidence: [],
  missingInformation: [],
};

describe("CodexHarness", () => {
  it("uses the SDK thread API with a structured schema and isolated permissions", async () => {
    const calls: Array<{ input: string; options: TurnOptions | undefined }> = [];
    const threadOptions: ThreadOptions[] = [];
    const client: CodexClient = {
      startThread: (options) => {
        if (options) threadOptions.push(options);
        return {
          id: "thread-sdk-1",
          run: async (input, runOptions) => {
            calls.push({ input, options: runOptions });
            return completedRun({
              status: "completed",
              summary: "Fixed fixture",
              validation: { commandsRun: ["bun test"], failures: [] },
            });
          },
        };
      },
      resumeThread: () => {
        throw new Error("not used");
      },
    };

    const harness = new CodexHarness(45, client);

    const result = await harness.startTask({
      ticket,
      approvedAnalysis: analysis,
      workspacePath: "/workspace/abc-1",
    });

    expect(result).toMatchObject({
      sessionId: "thread-sdk-1",
      status: "completed",
    });

    expect(threadOptions).toEqual([
      {
        workingDirectory: "/workspace/abc-1",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        webSearchMode: "disabled",
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toContain("You are resolving one bug");
    expect(calls[0]?.options?.outputSchema).toMatchObject({
      type: "object",
      required: ["status", "summary", "validation"],
    });
  });

  it("resumes through the SDK with the original workspace and sandbox settings", async () => {
    const threadOptions: ThreadOptions[] = [];
    const client: CodexClient = {
      startThread: () => {
        throw new Error("not used");
      },
      resumeThread: (id, options) => {
        if (options) threadOptions.push(options);
        expect(id).toBe("thread-sdk-2");
        return {
          id,
          run: async () =>
            completedRun({
              status: "completed",
              summary: "Revised fixture",
              validation: { commandsRun: ["bun test"], failures: [] },
            }),
        };
      },
    };

    const harness = new CodexHarness(45, client);

    const result = await harness.reviseTask("thread-sdk-2", {
      workspacePath: "/workspace/abc-1",
      ticketSummary: {
        key: ticket.key,
        summary: ticket.summary,
        expectedBehavior: "Fixture succeeds",
        actualBehavior: "Fixture fails",
      },
      diffSummary: "One changed fixture",
      review: {
        verdict: "revise",
        summary: "Fix the assertion",
        findings: [
          {
            severity: "blocking",
            problem: "Assertion is incomplete",
            correction: "Cover the failure mode",
          },
        ],
      },
    });

    expect(result.sessionId).toBe("thread-sdk-2");
    expect(threadOptions).toEqual([
      {
        workingDirectory: "/workspace/abc-1",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        webSearchMode: "disabled",
      },
    ]);
  });
});

function completedRun(output: unknown): RunResult {
  return {
    finalResponse: JSON.stringify(output),
    items: [],
    usage: null,
  };
}
