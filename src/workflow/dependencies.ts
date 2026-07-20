import { CodexHarness } from "../coding/codex-coding-harness.js";
import { FakeCodingHarness } from "../coding/fake-coding-harness.js";
import { LocalGitWorkspaces } from "../integrations/git/local-git-workspaces.js";
import { CLI } from "../integrations/forge/cli-runner.js";
import { GitHubClient } from "../integrations/forge/github-client.js";
import { GitLabClient } from "../integrations/forge/gitlab-client.js";
import { FakeJiraClient, HttpJiraClient } from "../integrations/jira/jira-client.js";
import type { JiraIssueDto } from "../integrations/jira/jira-types.js";
import { loadEnvironment } from "../app/environment.js";

const demoIssue: JiraIssueDto = {
  key: "DEMO-1",
  fields: {
    summary: "Demonstrate the automated bugfix workflow",
    description: "Create one focused simulated change.",
    status: { name: "Ready for development" },
    components: [{ name: "Bug Bot" }],
    labels: ["demo"],
    comment: { comments: [] },
    issuelinks: [],
    attachment: [],
  },
};

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required in real adapter mode`);
  return value;
}

const environment = loadEnvironment();

export const allowList = environment.TRUSTED_REPOSITORY_URL_PREFIXES;

export const jira =
  environment.ADAPTER_MODE === "real"
    ? new HttpJiraClient(
        required(environment.JIRA_BASE_URL, "JIRA_BASE_URL"),
        required(environment.JIRA_TOKEN, "JIRA_TOKEN"),
      )
    : new FakeJiraClient(new Map([[demoIssue.key, demoIssue]]));

const cli = new CLI();

export const forges = {
  github: new GitHubClient(cli),
  gitlab: new GitLabClient(cli),
};

export const codingHarness =
  environment.HARNESS_MODE === "codex"
    ? new CodexHarness(environment.CODEX_TIMEOUT_MINUTES)
    : new FakeCodingHarness();

export const workspaces = new LocalGitWorkspaces(environment.WORKSPACE_ROOT);

export const limits = {
  maxChangedFiles: environment.MAX_CHANGED_FILES,
  maxRepairAttempts: environment.MAX_REPAIR_ATTEMPTS,
};
