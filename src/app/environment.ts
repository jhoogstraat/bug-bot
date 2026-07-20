import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(9080),
  ADAPTER_MODE: z.enum(["fake", "real"]).default("fake"),
  HARNESS_MODE: z.enum(["fake", "codex"]).default("fake"),
  WORKSPACE_ROOT: z.string().default(".bug-bot-workspaces"),
  CODEX_TIMEOUT_MINUTES: z.coerce.number().positive().default(45),
  RESTATE_IDENTITY_KEYS: z
    .string()
    .optional()
    .transform((value) => {
      const keys = value
        ?.split(",")
        .map((key) => key.trim())
        .filter(Boolean);

      return keys?.length ? keys : undefined;
    }),
  JIRA_BASE_URL: z.url().optional(),
  JIRA_TOKEN: z.string().optional(),
  TRUSTED_REPOSITORY_URL_PREFIXES: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((prefix) => prefix.trim())
        .filter(Boolean),
    ),
  MAX_CHANGED_FILES: z.coerce.number().int().positive().default(15),
  MAX_REPAIR_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
});

export const loadEnvironment = (source: Record<string, string | undefined> = process.env) =>
  schema.parse(source);
