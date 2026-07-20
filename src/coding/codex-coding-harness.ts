import { Codex, type RunResult, type ThreadOptions, type TurnOptions } from "@openai/codex-sdk";
import { z } from "zod";
import { ticketAnalysisSchema, type TicketAnalysis } from "../domain/ticket-analysis.js";
import type {
  AnalyzeHarnessTaskInput,
  CodingHarness,
  HarnessReviewResult,
  HarnessRunResult,
  ReviewHarnessTaskInput,
  ReviseHarnessTaskInput,
  StartHarnessTaskInput,
} from "./coding-harness.js";
import { harnessReviewResultSchema, harnessRunOutputSchema } from "./coding-harness.js";
import {
  analysisTaskPrompt,
  initialTaskPrompt,
  reviewTaskPrompt,
  revisionTaskPrompt,
} from "./codex-prompts.js";
const analysisResultJsonSchema = z.toJSONSchema(ticketAnalysisSchema);
const runResultJsonSchema = z.toJSONSchema(harnessRunOutputSchema);
const reviewResultJsonSchema = z.toJSONSchema(harnessReviewResultSchema);

interface CodexThread {
  readonly id: string | null;
  run(input: string, options?: TurnOptions): Promise<RunResult>;
}

export interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(id: string, options?: ThreadOptions): CodexThread;
}

export class CodexHarness implements CodingHarness {
  private readonly codex: CodexClient;

  constructor(
    private readonly timeoutMinutes = 45,
    codex?: CodexClient,
  ) {
    this.codex =
      codex ??
      new Codex({
        env: codexEnvironment(),
      });
  }

  async analyzeTask(input: AnalyzeHarnessTaskInput): Promise<TicketAnalysis> {
    const invocation = await this.invoke(
      input.workspacePath,
      analysisTaskPrompt(input),
      analysisResultJsonSchema,
      undefined,
      true,
    );

    return ticketAnalysisSchema.parse(invocation.output);
  }

  async startTask(input: StartHarnessTaskInput): Promise<HarnessRunResult> {
    const invocation = await this.invoke(
      input.workspacePath,
      initialTaskPrompt(input),
      runResultJsonSchema,
    );

    return {
      ...harnessRunOutputSchema.parse(invocation.output),
      sessionId: invocation.sessionId,
    };
  }

  async reviseTask(sessionId: string, input: ReviseHarnessTaskInput): Promise<HarnessRunResult> {
    const invocation = await this.invoke(
      input.workspacePath,
      revisionTaskPrompt(input),
      runResultJsonSchema,
      sessionId,
    );

    return {
      ...harnessRunOutputSchema.parse(invocation.output),
      sessionId: invocation.sessionId,
    };
  }

  async review(input: ReviewHarnessTaskInput): Promise<HarnessReviewResult> {
    const invocation = await this.invoke(
      input.workspacePath,
      reviewTaskPrompt(input),
      reviewResultJsonSchema,
      undefined,
      true,
    );

    return harnessReviewResultSchema.parse(invocation.output);
  }

  private async invoke(
    workspacePath: string,
    prompt: string,
    schema: object,
    resumeSessionId?: string,
    readOnly = false,
  ) {
    const options: ThreadOptions = {
      workingDirectory: workspacePath,
      sandboxMode: readOnly ? "read-only" : "workspace-write",
      approvalPolicy: "never",
      webSearchMode: "disabled",
    };

    const thread = resumeSessionId
      ? this.codex.resumeThread(resumeSessionId, options)
      : this.codex.startThread(options);

    const controller = new AbortController();
    const timeoutState = { elapsed: false };
    const timer = setTimeout(() => {
      timeoutState.elapsed = true;
      controller.abort();
    }, this.timeoutMinutes * 60_000);

    try {
      const turn = await thread.run(prompt, { outputSchema: schema, signal: controller.signal });
      const sessionId = thread.id ?? resumeSessionId;
      if (!sessionId) throw new Error("Codex SDK did not return a thread ID");
      return {
        sessionId,
        output: parseJsonResponse(turn.finalResponse),
      };
    } catch (error) {
      if (timeoutState.elapsed) throw new Error(`Codex exceeded ${this.timeoutMinutes} minutes`);

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function codexEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      name !== "JIRA_TOKEN" &&
      name !== "GITLAB_TOKEN" &&
      name !== "GITHUB_TOKEN"
    )
      environment[name] = value;
  }

  return environment;
}

function parseJsonResponse(response: string): unknown {
  try {
    return JSON.parse(response);
  } catch (error) {
    throw new Error(`Codex returned invalid structured output: ${String(error)}`);
  }
}
