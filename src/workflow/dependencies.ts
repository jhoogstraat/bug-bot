import { CodexHarness } from "../coding/codex-coding-harness.js";
import { FakeCodingHarness } from "../coding/fake-coding-harness.js";
import type { CiFeedbackReader } from "../domain/ci.js";
import { CLI } from "../integrations/forge/cli-runner.js";
import type { ForgeClient, ForgeName } from "../integrations/forge/forge.js";
import { GitHubClient } from "../integrations/forge/github-client.js";
import { GitLabClient } from "../integrations/forge/gitlab-client.js";
import { LocalGitWorkspaces } from "../integrations/git/local-git-workspaces.js";
import { JenkinsClient } from "../integrations/jenkins/jenkins-client.js";
import { FakeJiraClient, HttpJiraClient } from "../integrations/jira/jira-client.js";
import type { JiraIssueDto } from "../integrations/jira/jira-types.js";
import type { ApplicationConfiguration } from "../app/configuration.js";
import type { BugFixWorkflowDependencies } from "./workflow.js";

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

export function createProductionDependencies(
  configuration: ApplicationConfiguration,
): BugFixWorkflowDependencies {
  const jira =
    configuration.jira.mode === "real"
      ? new HttpJiraClient(configuration.jira.baseUrl, configuration.jira.token)
      : new FakeJiraClient(new Map([[demoIssue.key, demoIssue]]));

  const forges: Record<ForgeName, ForgeClient> = {
    github: new GitHubClient(new CLI("gh")),
    gitlab: new GitLabClient(new CLI("glab")),
  };

  const codingHarness =
    configuration.coding.provider === "codex"
      ? new CodexHarness(configuration.coding.timeoutMinutes)
      : new FakeCodingHarness();

  const ciFeedbackReader: CiFeedbackReader =
    configuration.ci.provider === "jenkins"
      ? new JenkinsClient(
          configuration.ci.baseUrl,
          configuration.ci.username,
          configuration.ci.apiKey,
        )
      : {
          async readFailure(buildUrl: string) {
            return { buildUrl, logExcerpt: "Simulated Jenkins build failure." };
          },
        };

  return {
    jira,
    forges,
    codingHarness,
    ciFeedbackReader,
    workspaces: new LocalGitWorkspaces(configuration.workspace.root),
    allowList: configuration.workspace.trustedRepositoryUrlPrefixes,
    limits: {
      maxChangedFiles: configuration.limits.maxChangedFiles,
      maxRepairAttempts: configuration.limits.maxRepairAttempts,
      ciCheckName: configuration.ci.checkName,
      ciPollIntervalMinutes: configuration.ci.pollIntervalMinutes,
      maxCiPollAttempts: configuration.ci.maxPollAttempts,
    },
  };
}
