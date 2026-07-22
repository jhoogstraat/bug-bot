import { describe, expect, it } from "bun:test";
import type { RunResult, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import type { TicketAnalysis } from "../src/domain/ticket-analysis.js";
import type { NormalizedBugTicket } from "../src/domain/ticket.js";
import {
  CodexHarness,
  codexEnvironment,
  type CodexClient,
} from "../src/coding/codex-coding-harness.js";

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
  it("does not pass credentials into Codex", () => {
    expect(
      codexEnvironment({
        JENKINS_API_KEY: "jenkins-key",
        JIRA_TOKEN: "jira-token",
        AWS_ACCESS_KEY_ID: "aws-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        DEPLOY_SECRET: "deploy-secret",
        OPENAI_API_KEY: "codex-authentication-key",
        PATH: "/usr/bin",
        SAFE_SETTING: "allowed",
      }),
    ).toEqual({
      OPENAI_API_KEY: "codex-authentication-key",
      PATH: "/usr/bin",
    });
  });

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

  it("resumes the original session with bounded CI evidence", async () => {
    const calls: string[] = [];
    const client: CodexClient = {
      startThread: () => {
        throw new Error("not used");
      },
      resumeThread: (id) => ({
        id,
        run: async (input) => {
          calls.push(input);
          return completedRun({
            status: "completed",
            summary: "Repaired CI failure",
            validation: { commandsRun: ["bun test"], failures: [] },
          });
        },
      }),
    };

    const harness = new CodexHarness(45, client);

    const result = await harness.continueTask("thread-sdk-3", {
      workspacePath: "/workspace/abc-1",
      failure: {
        buildUrl: "https://jenkins.example/job/1/",
        logExcerpt: "Build failed",
      },
    });

    expect(result.sessionId).toBe("thread-sdk-3");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Address only the supplied CI evidence");
    expect(calls[0]).toContain("Never access GitLab, Jenkins, SonarQube");
  });
});

function completedRun(output: unknown): RunResult {
  return {
    finalResponse: JSON.stringify(output),
    items: [],
    usage: null,
  };
}
