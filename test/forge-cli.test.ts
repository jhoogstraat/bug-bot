import { describe, expect, it } from "bun:test";
import type { CreateMergeRequestInput } from "../src/integrations/forge/forge.js";
import type { CommandResult } from "../src/integrations/forge/cli-runner.js";
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
    const cli = new ScriptedCliRunner("gh", [failure(), success()]);

    await new GitHubClient(cli).createMergeRequest(input);

    expect(cli.calls).toEqual([
      { cwd: input.repositoryPath, args: ["pr", "view", "--json", "number,url"] },
      {
        cwd: input.repositoryPath,
        args: [
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
      },
    ]);
  });

  it("returns an existing pull request idempotently", async () => {
    const cli = new ScriptedCliRunner("gh", [
      json({ number: 7, url: "https://github.com/example/project/pull/7" }),
    ]);

    await new GitHubClient(cli).createMergeRequest(input);

    expect(cli.calls).toEqual([
      { cwd: input.repositoryPath, args: ["pr", "view", "--json", "number,url"] },
    ]);
  });

  it("reads the named check from the exact commit", async () => {
    const cli = new ScriptedCliRunner("gh", [
      json({
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            details_url: "https://jenkins.example/build/12",
          },
        ],
      }),
    ]);

    const check = await new GitHubClient(cli).waitForChecks({
      repositoryPath: input.repositoryPath,
      commitSha: "abc123",
      checkName: "build",
    });

    expect(check).toEqual({
      state: "passed",
      targetUrl: "https://jenkins.example/build/12",
    });

    expect(cli.calls).toEqual([
      {
        cwd: input.repositoryPath,
        args: ["api", "repos/{owner}/{repo}/commits/abc123/check-runs"],
      },
    ]);
  });

  it("reports an absent named check as pending", async () => {
    const cli = new ScriptedCliRunner("gh", [json({ check_runs: [] })]);

    const check = await new GitHubClient(cli).waitForChecks({
      repositoryPath: input.repositoryPath,
      commitSha: "abc123",
      checkName: "build",
    });

    expect(check).toEqual({ state: "pending", targetUrl: null });
  });
});

describe("GitLab CLI forge client", () => {
  it("creates a draft merge request in the cloned repository", async () => {
    const cli = new ScriptedCliRunner("glab", [failure(), success()]);

    await new GitLabClient(cli).createMergeRequest(input);

    expect(cli.calls).toEqual([
      { cwd: input.repositoryPath, args: ["mr", "view", "--output", "json"] },
      {
        cwd: input.repositoryPath,
        args: [
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
      },
    ]);
  });

  it("returns an existing merge request idempotently", async () => {
    const cli = new ScriptedCliRunner("glab", [
      json({ iid: 7, web_url: "https://gitlab.example.com/group/project/-/merge_requests/7" }),
    ]);

    await new GitLabClient(cli).createMergeRequest(input);

    expect(cli.calls).toHaveLength(1);
  });

  it.each([
    ["pending", "pending"],
    ["waiting_for_callback", "pending"],
    ["success", "passed"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ] as const)("maps a %s GitLab status to %s", async (gitLabStatus, expectedState) => {
    const cli = new ScriptedCliRunner("glab", [
      json([
        {
          name: "build",
          status: gitLabStatus,
          sha: "abc123",
          target_url: "https://jenkins.example/build/12",
        },
      ]),
    ]);

    const check = await new GitLabClient(cli).waitForChecks({
      repositoryPath: input.repositoryPath,
      commitSha: "abc123",
      checkName: "build",
    });

    expect(check).toEqual({
      state: expectedState,
      targetUrl: "https://jenkins.example/build/12",
    });

    expect(cli.calls).toEqual([
      {
        cwd: input.repositoryPath,
        args: [
          "api",
          "projects/:id/repository/commits/abc123/statuses?name=build&all=true&sort=desc&order_by=id",
        ],
      },
    ]);
  });

  it("reports a missing named status as pending", async () => {
    const cli = new ScriptedCliRunner("glab", [json([])]);

    const check = await new GitLabClient(cli).waitForChecks({
      repositoryPath: input.repositoryPath,
      commitSha: "abc123",
      checkName: "build",
    });

    expect(check).toEqual({ state: "pending", targetUrl: null });
  });

  it("keeps a failed status without a target URL actionable", async () => {
    const cli = new ScriptedCliRunner("glab", [json([{ name: "build", status: "failed" }])]);

    const check = await new GitLabClient(cli).waitForChecks({
      repositoryPath: input.repositoryPath,
      commitSha: "abc123",
      checkName: "build",
    });

    expect(check).toEqual({ state: "failed", targetUrl: null });
  });

  it("rejects malformed commit status output at the CLI boundary", async () => {
    const cli = new ScriptedCliRunner("glab", [success("not-json")]);

    expect(
      new GitLabClient(cli).waitForChecks({
        repositoryPath: input.repositoryPath,
        commitSha: "abc123",
        checkName: "build",
      }),
    ).rejects.toThrow();
  });
});

interface CliCall {
  args: string[];
  cwd: string;
}

class ScriptedCliRunner extends CLI {
  readonly calls: CliCall[] = [];

  constructor(
    executable: string,
    private readonly results: CommandResult[],
  ) {
    super(executable);
  }

  override async run(args: string[], cwd: string): Promise<CommandResult> {
    this.calls.push({ args, cwd });
    const result = this.results.shift();
    if (!result) throw new Error("No scripted CLI result");
    return result;
  }
}

function success(stdout = ""): CommandResult {
  return { exitCode: 0, signalCode: null, stdout, stderr: "" };
}

function failure(stderr = "not found"): CommandResult {
  return { exitCode: 1, signalCode: null, stdout: "", stderr };
}

function json(value: unknown): CommandResult {
  return success(JSON.stringify(value));
}
