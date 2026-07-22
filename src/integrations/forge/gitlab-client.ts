import { z } from "zod";
import { CLI } from "./cli-runner.js";
import type { CreateMergeRequestInput, CiCheck, ForgeClient, WaitForChecksInput } from "./forge.js";

const CommitStatusesResponse = z
  .object({
    name: z.string().nullish(),
    target_url: z.url().nullish(),
    status: z.string(),
    sha: z.string().nullish(),
  })
  .array();

export class GitLabClient implements ForgeClient {
  constructor(private readonly glab: CLI) {}

  async createMergeRequest(input: CreateMergeRequestInput) {
    const existing = await this.glab.run(["mr", "view", "--output", "json"], input.repositoryPath);
    if (existing.exitCode === 0) return;

    const created = await this.glab.run(
      [
        "mr",
        "create",
        "--source-branch",
        input.sourceBranch,
        "--target-branch",
        input.targetBranch,
        "--title",
        input.title,
        "--description",
        input.description,
        "--no-editor",
        "--yes",
        "--draft",
        "--assignee",
        "@me",
        "--label",
        "LHIND",
      ],
      input.repositoryPath,
    );

    if (created.exitCode !== 0)
      throw new Error(`glab failed to create merge request: ${created.stderr}`);
  }

  async waitForChecks(input: WaitForChecksInput): Promise<CiCheck> {
    const query = new URLSearchParams({
      name: input.checkName,
      all: "true",
      sort: "desc",
      order_by: "id",
    });

    const statusResult = await this.glab.run(
      [
        "api",
        `projects/:id/repository/commits/${encodeURIComponent(input.commitSha)}/statuses?${query.toString()}`,
      ],
      input.repositoryPath,
    );

    if (statusResult.exitCode !== 0) {
      throw new Error(`glab failed to fetch commit statuses: ${statusResult.stderr}`);
    }

    const status = CommitStatusesResponse.parse(JSON.parse(statusResult.stdout)).find(
      (candidate) => candidate.name === input.checkName,
    );

    if (!status) return { state: "pending", targetUrl: null };
    if (status.sha && status.sha !== input.commitSha) {
      throw new Error("glab returned a status for a different commit");
    }

    return {
      state: mapGitLabStatus(status.status),
      targetUrl: status.target_url ?? null,
    };
  }
}

function mapGitLabStatus(status: string): CiCheck["state"] {
  if (status === "success") return "passed";
  if (status === "failed") return "failed";
  if (["canceled", "canceling", "skipped", "manual"].includes(status)) return "canceled";
  return "pending";
}
