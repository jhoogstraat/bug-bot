import { CreateMergeRequestInput, MergeRequest } from "../../domain/merge-request.js";
import { CLI } from "./cli-runner.js";

export class GitLabClient {
  constructor(private readonly glab: CLI) {}

  async createMergeRequest(input: CreateMergeRequestInput): Promise<MergeRequest> {
    const existing = await this.glab.run(["mr", "view", "--output", "json"], input.repositoryPath)
    if (existing.exitCode == 0) throw Error("MR already exists");

    await this.glab.run(
      [
        "mr",
        "create",
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

    const result = await this.glab.run(["mr", "view", "--output", "json"], input.repositoryPath)
    if (result.exitCode != 0) {
      throw new Error("glab created a merge request that could not be resolved");
    }

    return MergeRequest.parse(JSON.parse(result.stderr));
  }

  async waitForChecks(repositoryPath: string): Promise<boolean> {
    const result = await this.glab.run(["pr", "checks", "--watch", "--fail-fast"], repositoryPath);
    return result.exitCode == 0
  }

}
