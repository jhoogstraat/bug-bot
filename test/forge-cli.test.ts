import { describe, expect, it } from "bun:test";
import type { CreateMergeRequestInput } from "../src/domain/merge-request.js";
import { CLI } from "../src/integrations/forge/cli-runner.js";
import { GitHubClient } from "../src/integrations/forge/github-client.js";
import { GitLabClient } from "../src/integrations/forge/gitlab-client.js";

const input: CreateMergeRequestInput = {
  repositoryPath: "/workspaces/ABC-1",
  sourceBranch: "agent/abc-1/fix",
  targetBranch: "main",
  title: "ABC-1: Fix the bug",
  description: "Focused fix",
};

describe("GitHub CLI forge client", () => {
  it("creates a draft pull request in the cloned repository", async () => {
    const cli = new ScriptedCliRunner([
      "[]",
      "https://github.com/example/project/pull/42\n",
      JSON.stringify([
        {
          url: "https://github.com/example/project/pull/42",
        },
      ]),
    ]);

    const pullRequest = await new GitHubClient(cli).createMergeRequest(input);

    expect(pullRequest).toEqual({ url: "https://github.com/example/project/pull/42" });

    expect(cli.calls[1]).toEqual({
      executable: "gh",
      cwd: "/workspaces/ABC-1",
      args: [
        "pr",
        "create",
        "--head",
        "agent/abc-1/fix",
        "--base",
        "main",
        "--title",
        "ABC-1: Fix the bug",
        "--body",
        "Focused fix",
        "--draft",
        "--assignee",
        "@me",
        "--label",
        "LHIND",
      ],
    });
  });

  it("returns the existing pull request without creating a duplicate", async () => {
    const cli = new ScriptedCliRunner([
      JSON.stringify([
        {
          url: "https://github.com/example/project/pull/7",
        },
      ]),
    ]);

    const pullRequest = await new GitHubClient(cli).createMergeRequest(input);

    expect(pullRequest.url).toBe("https://github.com/example/project/pull/7");
    expect(cli.calls).toHaveLength(1);
  });
});

describe("GitLab CLI forge client", () => {
  it("creates a draft merge request in the cloned repository", async () => {
    const cli = new ScriptedCliRunner([
      "[]",
      "https://gitlab.example.com/group/project/-/merge_requests/24\n",
      JSON.stringify([
        {
          web_url: "https://gitlab.example.com/group/project/-/merge_requests/24",
        },
      ]),
    ]);

    const mergeRequest = await new GitLabClient(cli).createMergeRequest(input);

    expect(mergeRequest).toEqual({
      url: "https://gitlab.example.com/group/project/-/merge_requests/24",
    });

    expect(cli.calls[1]).toEqual({
      executable: "glab",
      cwd: "/workspaces/ABC-1",
      args: [
        "mr",
        "create",
        "--source-branch",
        "agent/abc-1/fix",
        "--target-branch",
        "main",
        "--title",
        "ABC-1: Fix the bug",
        "--description",
        "Focused fix",
        "--no-editor",
        "--yes",
        "--draft",
        "--assignee",
        "@me",
        "--label",
        "LHIND",
      ],
    });
  });

  it("rejects malformed CLI output at the subprocess boundary", async () => {
    const cli = new ScriptedCliRunner(["not-json"]);

    expect(new GitLabClient(cli).createMergeRequest(input)).rejects.toThrow(
      "glab returned invalid merge request JSON",
    );
  });
});

interface CliCall {
  executable: string;
  args: string[];
  cwd: string;
}

class ScriptedCliRunner extends CLI {
  readonly calls: CliCall[] = [];

  constructor(private readonly outputs: string[]) {
    super();
  }

  override async run(executable: string, args: readonly string[], cwd: string): Promise<string> {
    this.calls.push({ executable, args: [...args], cwd });
    const output = this.outputs.shift();
    if (output === undefined) throw new Error(`No scripted output for ${executable}`);
    return output;
  }
}
