import type { NormalizedBugTicket } from "../../domain/ticket.js";
import type { JiraIssueDto } from "./jira-types.js";

const MAX_COMMENTS = 10;
const MAX_LINKED_ISSUES = 5;
const MAX_TEXT_CHARACTERS = 12_000;

function plainText(value: unknown, maxCharacters: number): string | undefined {
  if (typeof value === "string") return truncate(stripHtml(value).trim(), maxCharacters);
  if (!value || typeof value !== "object") return undefined;
  const fragments: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") fragments.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ("text" in node && typeof node.text === "string") fragments.push(node.text);
      else if ("content" in node) walk(node.content);
    }
  };

  walk(value);
  const result = fragments.join(" ").replace(/\s+/g, " ").trim();
  return result ? truncate(result, maxCharacters) : undefined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function truncate(value: string, maxCharacters: number): string {
  return value.slice(0, maxCharacters);
}

export function normalizeJiraIssue(issue: JiraIssueDto): NormalizedBugTicket {
  const fields = issue.fields;
  const text = (value: unknown): string | undefined => plainText(value, MAX_TEXT_CHARACTERS);
  const description = text(fields.description);
  const acceptanceCriteria = text(fields.acceptanceCriteria ?? fields.customfield_acceptance);
  const expected = text(fields.expectedBehavior ?? fields.customfield_expected);
  const actual = text(fields.actualBehavior ?? fields.customfield_actual);
  const reproduction = text(fields.reproductionSteps ?? fields.customfield_reproduction);
  const environment = text(fields.environment);
  const linkedIssues = (fields.issuelinks ?? []).slice(0, MAX_LINKED_ISSUES).flatMap((link) => {
    const related = link.outwardIssue ?? link.inwardIssue;
    if (!related) return [];
    return [
      {
        key: related.key,
        relationship: link.outwardIssue ? link.type.outward : link.type.inward,
        summary: truncate(related.fields.summary, MAX_TEXT_CHARACTERS),
      },
    ];
  });

  return {
    key: issue.key,
    summary: truncate(fields.summary, MAX_TEXT_CHARACTERS),
    ...(description ? { description } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    ...(expected ? { expectedBehavior: expected } : {}),
    ...(actual ? { actualBehavior: actual } : {}),
    reproductionSteps: reproduction
      ? reproduction
          .split(/\r?\n|\s*\d+\.\s+/)
          .map((step) => step.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
    status: fields.status.name,
    ...(fields.priority?.name ? { priority: fields.priority.name } : {}),
    ...(fields.components?.[0]?.name ? { component: fields.components[0].name } : {}),
    ...(environment ? { environment } : {}),
    affectedVersions: [...new Set((fields.versions ?? []).map((version) => version.name))].slice(
      0,
      20,
    ),
    statusHistory: (issue.changelog?.histories ?? [])
      .flatMap((history) =>
        history.items.flatMap((item) => {
          const to = item.toString;
          if (item.field.toLowerCase() !== "status" || !to) return [];
          return [
            {
              ...(item.fromString ? { from: item.fromString } : {}),
              to,
              ...(history.created ? { changedAt: history.created } : {}),
              ...(history.author?.displayName ? { author: history.author.displayName } : {}),
            },
          ];
        }),
      )
      .slice(-20),
    labels: [...new Set(fields.labels ?? [])].slice(0, 20),
    relevantComments: (fields.comment?.comments ?? [])
      .slice(-MAX_COMMENTS)
      .map((comment) => ({
        ...(comment.author?.displayName ? { author: comment.author.displayName } : {}),
        ...(comment.created ? { createdAt: comment.created } : {}),
        body: text(comment.body) ?? "",
      }))
      .filter((comment) => comment.body.length > 0),
    linkedIssues,
    attachments: (fields.attachment ?? []).slice(0, 20).map((attachment) => ({
      filename: attachment.filename,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    })),
  };
}
