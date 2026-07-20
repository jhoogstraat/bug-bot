import { z } from "zod";

const jiraCommentSchema = z.object({
  author: z.object({ displayName: z.string().optional() }).optional(),
  created: z.string().optional(),
  body: z.unknown(),
});

const linkedIssueSchema = z.object({
  key: z.string(),
  fields: z.object({ summary: z.string() }),
});

const jiraIssueLinkSchema = z.object({
  type: z.object({ inward: z.string(), outward: z.string() }),
  inwardIssue: linkedIssueSchema.optional(),
  outwardIssue: linkedIssueSchema.optional(),
});

const jiraAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string().optional(),
});

export const jiraIssueSchema = z.object({
  key: z.string(),
  changelog: z
    .object({
      histories: z.array(
        z.object({
          created: z.string().optional(),
          author: z.object({ displayName: z.string().optional() }).optional(),
          items: z.array(
            z.object({
              field: z.string(),
              fromString: z.string().optional(),
              toString: z.string().optional(),
            }),
          ),
        }),
      ),
    })
    .optional(),
  fields: z
    .object({
      summary: z.string(),
      description: z.unknown().optional(),
      status: z.object({ name: z.string() }),
      priority: z.object({ name: z.string() }).optional(),
      components: z.array(z.object({ name: z.string() })).optional(),
      environment: z.unknown().optional(),
      labels: z.array(z.string()).optional(),
      comment: z.object({ comments: z.array(jiraCommentSchema) }).optional(),
      issuelinks: z.array(jiraIssueLinkSchema).optional(),
      attachment: z.array(jiraAttachmentSchema).optional(),
      versions: z.array(z.object({ name: z.string() })).optional(),
    })
    .catchall(z.unknown()),
});

export type JiraIssueDto = z.infer<typeof jiraIssueSchema>;
