import { z } from "zod";
import { jiraIssueSchema, type JiraIssueDto } from "./jira-types.js";

const currentUserSchema = z.object({ accountId: z.string() });
const remoteLinksSchema = z.array(z.object({ globalId: z.string().optional() }));
const transitionsSchema = z.object({
  transitions: z.array(z.object({ id: z.string(), name: z.string() })),
});

export class HttpJiraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async fetchIssue(issueKey: string): Promise<JiraIssueDto> {
    const response = await this.request(
      new URL(`${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?expand=changelog`),
      { headers: { accept: "application/json" } },
    );

    return jiraIssueSchema.parse(await response.json());
  }

  async claimIssue(issueKey: string): Promise<void> {
    const myself = await this.request(new URL(`${this.baseUrl}/rest/api/3/myself`), {
      headers: { accept: "application/json" },
    });

    const { accountId } = currentUserSchema.parse(await myself.json());
    await this.request(
      new URL(`${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      },
    );

    await this.transition(issueKey, "In Progress");
  }

   async transition(issueKey: string, targetName: string): Promise<void> {
    const issue = await this.fetchIssue(issueKey);
    if (issue.fields.status.name.toLowerCase() === targetName.toLowerCase()) return;
    const url = new URL(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );

    const available = await this.request(url, { headers: { accept: "application/json" } });
    const body = transitionsSchema.parse(await available.json());
    const transition = body.transitions.find(
      (item) => item.name.toLowerCase() === targetName.toLowerCase(),
    );

    if (!transition) {
      const refreshed = await this.fetchIssue(issueKey);
      if (refreshed.fields.status.name.toLowerCase() === targetName.toLowerCase()) return;
      throw new Error(`Jira transition ${targetName} is unavailable for ${issueKey}`);
    }

    await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Jira returned ${response.status}`);
    return response;
  }
}

export class FakeJiraClient {
  constructor(private readonly issues: ReadonlyMap<string, JiraIssueDto>) {}

  async fetchIssue(issueKey: string): Promise<JiraIssueDto> {
    const issue = this.issues.get(issueKey);
    if (!issue) throw new Error(`Fake Jira issue ${issueKey} does not exist`);
    return structuredClone(issue);
  }

  claimIssue(): Promise<void> {
    return Promise.resolve();
  }

  ensureMergeRequestLink(): Promise<void> {
    return Promise.resolve();
  }

  async transition(_issueKey: string, _targetName: string): Promise<void> {
    return Promise.resolve();
  }
}
