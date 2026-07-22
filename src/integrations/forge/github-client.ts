import { z } from "zod";
import { CLI } from "./cli-runner.js";
import type { CreateMergeRequestInput, CiCheck, ForgeClient, WaitForChecksInput } from "./forge.js";

const GitHubCheckRuns = z.object({
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      details_url: z.url().nullable(),
    }),
  ),
});

export class GitHubClient implements ForgeClient {
  constructor(private readonly gh: CLI) {}

  async createMergeRequest(input: CreateMergeRequestInput) {
    const existing = await this.gh.run(
      ["pr", "view", "--json", "number,url"],
      input.repositoryPath,
    );

    if (existing.exitCode === 0) return;

    const created = await this.gh.run(
      [
        "pr",
        "create",
        "--head",
        input.sourceBranch,
        "--base",
        input.targetBranch,
        "--title",
        input.title,
        "--body",
        input.description,
        "--draft",
        "--assignee",
        "@me",
        "--label",
        "LHIND",
      ],
      input.repositoryPath,
    );

    if (created.exitCode !== 0)
      throw new Error(`gh failed to create pull request: ${created.stderr}`);
  }

  async waitForChecks(input: WaitForChecksInput): Promise<CiCheck> {
    const result = await this.gh.run(
      ["api", `repos/{owner}/{repo}/commits/${encodeURIComponent(input.commitSha)}/check-runs`],
      input.repositoryPath,
    );

    if (result.exitCode !== 0)
      throw new Error(`gh failed to fetch commit checks: ${result.stderr}`);

    const check = GitHubCheckRuns.parse(JSON.parse(result.stdout)).check_runs.find(
      (candidate) => candidate.name === input.checkName,
    );

    if (!check || check.status !== "completed") return { state: "pending", targetUrl: null };

    return {
      state:
        check.conclusion === "success"
          ? "passed"
          : check.conclusion === "failure" || check.conclusion === "timed_out"
            ? "failed"
            : "canceled",
      targetUrl: check.details_url,
    };
  }
}
