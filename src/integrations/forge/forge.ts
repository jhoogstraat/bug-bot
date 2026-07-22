import { z } from "zod";

export const ForgeName = z.enum(["github", "gitlab"]);
export type ForgeName = z.infer<typeof ForgeName>;

export interface CreateMergeRequestInput {
  repositoryPath: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
}

export interface WaitForChecksInput {
  repositoryPath: string;
  commitSha: string;
  checkName: string;
}

export interface CiCheck {
  state: "pending" | "passed" | "failed" | "canceled";
  targetUrl: string | null;
}

export interface ForgeClient {
  createMergeRequest(input: CreateMergeRequestInput): Promise<void>;
  waitForChecks(input: WaitForChecksInput): Promise<CiCheck>;
}
