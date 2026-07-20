import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import * as clients from "@restatedev/restate-sdk-clients";
import * as restate from "@restatedev/restate-sdk";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { createEndpointHandler } from "@restatedev/restate-sdk";
import * as http2 from "node:http2";
import { FakeJiraClient } from "../src/integrations/jira/jira-client.js";
import type { JiraIssueDto } from "../src/integrations/jira/jira-types.js";
import { FakeCodingHarness } from "../src/coding/fake-coding-harness.js";
import type { AnalyzeHarnessTaskInput } from "../src/coding/coding-harness.js";
import { CLI } from "../src/integrations/forge/cli-runner.js";
import { GitHubClient } from "../src/integrations/forge/github-client.js";
import { GitLabClient } from "../src/integrations/forge/gitlab-client.js";
import { LocalGitWorkspaces } from "../src/integrations/git/local-git-workspaces.js";
import type {
  BugFixWorkflowInput,
  BugFixWorkflowResult,
} from "../src/workflow/workflow.js";

const exec = promisify(execFile);
let productionRepository: { forge: "gitlab"; url: string };

const issue: JiraIssueDto = {
  key: "ABC-1",
  fields: {
    summary: "Replay-safe queue capture",
    description: "Fixture",
    status: { name: "Open" },
    components: [],
    labels: [],
    comment: { comments: [] },
    issuelinks: [],
    attachment: [],
  },
};

const workflowIssues: JiraIssueDto[] = [
  {
    ...issue,
    key: "DEMO-1",
    fields: {
      ...issue.fields,
      summary: "Replay the production bugfix workflow",
      components: [{ name: "Bug Bot" }],
    },
  },
  {
    ...issue,
    key: "ERROR-1",
    fields: {
      ...issue.fields,
      summary: "Propagate a terminal workflow failure",
      components: [{ name: "Bug Bot" }],
    },
  },
];

type ProductionWorkflowDefinition = restate.WorkflowDefinition<
  "BugFixWorkflow",
  {
    run: (ctx: restate.WorkflowContext, input: unknown) => Promise<BugFixWorkflowResult>;
  }
>;

const describeWithRestate = process.env.RUN_RESTATE_TESTS === "1" ? describe : describe.skip;

describeWithRestate("Restate always-replay integration", () => {
  let environment: RestateIntegrationEnvironment | undefined;
  let ingress: clients.Ingress;
  let productionWorkflow: ProductionWorkflowDefinition;
  let fixtureRoot: string | undefined;

  beforeAll(async () => {
    const fixture = await createProductionWorkflowFixture();
    fixtureRoot = fixture.root;

    await mock.module("../src/workflows/bugfix/dependencies.js", () => fixture.dependencies);
    ({ BugFixWorkflow: productionWorkflow } = await import("../src/workflow/workflow.js"));

    environment = await startRestateIntegrationEnvironment({
      services: [productionWorkflow],
      alwaysReplay: true,
      disableRetries: true,
      storage: "memory",
    });

    ingress = clients.connect({ url: environment.baseUrl() });
  }, 30_000);

  afterAll(async () => {
    await environment?.stop();
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("replays the production bugfix workflow", async () => {
    const result = await callProductionWorkflow(ingress, "DEMO-1");

    expect(result).toEqual({
      state: "DONE",
      detail: "Ready to merge; merge remains a human action",
    });
  });

  it("lets Restate expose terminal failures", async () => {
    expect(callProductionWorkflow(ingress, "ERROR-1")).rejects.toThrow(
      "Analysis returned MISMATCHED-1 for ERROR-1",
    );
  });
});

async function callProductionWorkflow(
  ingress: clients.Ingress,
  issueKey: string,
): Promise<BugFixWorkflowResult> {
  return await ingress.call<BugFixWorkflowInput, BugFixWorkflowResult>({
    service: "BugFixWorkflow",
    handler: "run",
    key: `bugfix/${issueKey}/1`,
    parameter: { issueKey, ...productionRepository },
  });
}

class ReplayCodingHarness extends FakeCodingHarness {
  override async analyzeTask(input: AnalyzeHarnessTaskInput) {
    const analysis = await super.analyzeTask(input);
    return input.ticket.key === "ERROR-1" ? { ...analysis, issueKey: "MISMATCHED-1" } : analysis;
  }
}

async function createProductionWorkflowFixture() {
  const root = await mkdtemp(join(tmpdir(), "bug-bot-replay-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  await exec("git", ["init", "--initial-branch=main", seed]);
  await exec("git", ["config", "user.name", "Bug Bot Test"], { cwd: seed });
  await exec("git", ["config", "user.email", "bug-bot@example.test"], { cwd: seed });
  await writeFile(join(seed, "README.md"), "Replay fixture\n", "utf8");
  await exec("git", ["add", "README.md"], { cwd: seed });
  await exec("git", ["-c", "commit.gpgsign=false", "commit", "-m", "test: seed replay fixture"], {
    cwd: seed,
  });

  await exec("git", ["remote", "add", "origin", remote], { cwd: seed });
  await exec("git", ["push", "origin", "main"], { cwd: seed });

  const repository: { forge: "gitlab"; url: string } = {
    forge: "gitlab",
    url: pathToFileURL(remote).href,
  };

  productionRepository = repository;

  const jira = new FakeJiraClient(new Map(workflowIssues.map((item) => [item.key, item])));
  const forgeCli = new ReplayForgeCliRunner();

  return {
    root,
    repository,
    dependencies: {
      jira,
      forges: {
        github: new GitHubClient(forgeCli),
        gitlab: new GitLabClient(forgeCli),
      },
      codingHarness: new ReplayCodingHarness(),
      workspaces: new LocalGitWorkspaces(join(root, "workspaces")),
      allowList: [repository.url],
      limits: {
        maxChangedFiles: 5,
        maxRepairAttempts: 2,
      },
    },
  };
}

class ReplayForgeCliRunner extends CLI {
  private created = false;

  override async run(_executable: string, args: readonly string[]): Promise<string> {
    if (args[1] === "create") {
      this.created = true;
      return "https://gitlab.example/bug-bot/-/merge_requests/1\n";
    }

    return this.created
      ? '[{"web_url":"https://gitlab.example/bug-bot/-/merge_requests/1"}]'
      : "[]";
  }
}

interface RestateIntegrationEnvironment {
  baseUrl(): string;
  stop(): Promise<void>;
}

type RestateEnvironmentOptions = Parameters<typeof RestateTestEnvironment.start>[0];

async function startRestateIntegrationEnvironment(
  options: RestateEnvironmentOptions,
): Promise<RestateIntegrationEnvironment> {
  if (process.env.RESTATE_CONTAINER_RUNTIME === "apple")
    return await AppleContainerRestateEnvironment.start(options);

  return await RestateTestEnvironment.start(options);
}

class AppleContainerRestateEnvironment implements RestateIntegrationEnvironment {
  private constructor(
    private readonly endpoint: http2.Http2Server,
    private readonly name: string,
    private readonly ingressPort: number,
  ) {}

  static async start(
    options: RestateEnvironmentOptions,
  ): Promise<AppleContainerRestateEnvironment> {
    const endpoint = http2.createServer(createEndpointHandler(options));
    await listen(endpoint);
    const endpointAddress = endpoint.address();
    if (!endpointAddress || typeof endpointAddress === "string")
      throw new Error("Restate test endpoint did not bind a TCP port");

    const name = `bug-bot-restate-${crypto.randomUUID()}`;
    const ingressPort = await availablePort();
    const adminPort = await availablePort();
    try {
      await exec("container", [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        `127.0.0.1:${ingressPort}:8080`,
        "--publish",
        `127.0.0.1:${adminPort}:9070`,
        "--env",
        "RESTATE_WORKER__INVOKER__INACTIVITY_TIMEOUT=0s",
        "--env",
        "RESTATE_DEFAULT_RETRY_POLICY__MAX_ATTEMPTS=1",
        "--env",
        "RESTATE_DEFAULT_RETRY_POLICY__ON_MAX_ATTEMPTS=kill",
        "docker.io/restatedev/restate:latest",
      ]);

      await waitForHealthy(`http://127.0.0.1:${adminPort}/health`);
      const registration = await fetch(`http://127.0.0.1:${adminPort}/deployments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uri: `http://host.container.internal:${endpointAddress.port}`,
        }),
      });

      if (!registration.ok)
        throw new Error(
          `Restate service registration failed: ${registration.status} ${await registration.text()}`,
        );

      return new AppleContainerRestateEnvironment(endpoint, name, ingressPort);
    } catch (error) {
      endpoint.close();
      await stopContainer(name);
      throw error;
    }
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.ingressPort}`;
  }

  async stop(): Promise<void> {
    this.endpoint.close();
    await stopContainer(this.name);
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("Could not reserve a TCP port");
  return address.port;
}

async function listen(server: http2.Http2Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });
}

async function waitForHealthy(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Restate has not finished starting yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Restate did not become healthy at ${url}`);
}

async function stopContainer(name: string): Promise<void> {
  try {
    await exec("container", ["stop", name]);
  } catch {
    // A failed startup may already have removed the disposable container.
  }
}
