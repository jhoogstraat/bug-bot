import { resolve } from "node:path";
import { z } from "zod";

const nonEmptyString = z.string().trim().nonempty();
const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  nonEmptyString.optional(),
);

const tomlConfigurationSchema = z.strictObject({
  server: z
    .strictObject({
      port: z.number().int().positive().default(9080),
    })
    .prefault({}),
  restate: z
    .strictObject({
      identity_keys: z.array(nonEmptyString).default([]),
    })
    .prefault({}),
  jira: z
    .strictObject({
      mode: z.enum(["fake", "real"]).default("fake"),
      base_url: z.url().optional(),
    })
    .prefault({}),
  coding: z
    .strictObject({
      provider: z.enum(["fake", "codex"]).default("fake"),
      timeout_minutes: z.number().positive().default(45),
    })
    .prefault({}),
  workspace: z
    .strictObject({
      root: nonEmptyString.default(".bug-bot-workspaces"),
      trusted_repository_url_prefixes: z.array(nonEmptyString).default([]),
    })
    .prefault({}),
  ci: z
    .strictObject({
      provider: z.enum(["fake", "jenkins"]).default("fake"),
      check_name: nonEmptyString.default("build"),
      poll_interval_minutes: z.number().positive().default(5),
      max_poll_attempts: z.number().int().positive().default(72),
      base_url: z.url().optional(),
    })
    .prefault({}),
  limits: z
    .strictObject({
      max_changed_files: z.number().int().positive().default(15),
      max_repair_attempts: z.number().int().nonnegative().default(3),
    })
    .prefault({}),
});

const secretEnvironmentSchema = z.strictObject({
  JIRA_TOKEN: optionalSecret,
  JENKINS_USERNAME: optionalSecret,
  JENKINS_API_KEY: optionalSecret,
});

const applicationConfigurationSchema = z.strictObject({
  server: z.strictObject({ port: z.number().int().positive() }),
  restate: z.strictObject({ identityKeys: z.array(nonEmptyString) }),
  jira: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("fake") }),
    z.strictObject({
      mode: z.literal("real"),
      baseUrl: z.url(),
      token: nonEmptyString,
    }),
  ]),
  coding: z.strictObject({
    provider: z.enum(["fake", "codex"]),
    timeoutMinutes: z.number().positive(),
  }),
  workspace: z.strictObject({
    root: nonEmptyString,
    trustedRepositoryUrlPrefixes: z.array(nonEmptyString),
  }),
  ci: z.discriminatedUnion("provider", [
    z.strictObject({
      provider: z.literal("fake"),
      checkName: nonEmptyString,
      pollIntervalMinutes: z.number().positive(),
      maxPollAttempts: z.number().int().positive(),
    }),
    z.strictObject({
      provider: z.literal("jenkins"),
      baseUrl: z.url(),
      username: nonEmptyString,
      apiKey: nonEmptyString,
      checkName: nonEmptyString,
      pollIntervalMinutes: z.number().positive(),
      maxPollAttempts: z.number().int().positive(),
    }),
  ]),
  limits: z.strictObject({
    maxChangedFiles: z.number().int().positive(),
    maxRepairAttempts: z.number().int().nonnegative(),
  }),
});

export type ApplicationConfiguration = z.infer<typeof applicationConfigurationSchema>;

export type ConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

export interface LoadConfigurationOptions {
  cwd?: string;
  environment?: ConfigurationEnvironment;
}

export function parseConfiguration(
  source: unknown,
  environment: ConfigurationEnvironment = process.env,
): ApplicationConfiguration {
  const toml = tomlConfigurationSchema.parse(source);
  const secrets = secretEnvironmentSchema.parse({
    JIRA_TOKEN: environment.JIRA_TOKEN,
    JENKINS_USERNAME: environment.JENKINS_USERNAME,
    JENKINS_API_KEY: environment.JENKINS_API_KEY,
  });

  const jira =
    toml.jira.mode === "real"
      ? {
          mode: toml.jira.mode,
          baseUrl: required(toml.jira.base_url, "jira.base_url"),
          token: required(secrets.JIRA_TOKEN, "JIRA_TOKEN"),
        }
      : { mode: toml.jira.mode };

  const ciCommon = {
    checkName: toml.ci.check_name,
    pollIntervalMinutes: toml.ci.poll_interval_minutes,
    maxPollAttempts: toml.ci.max_poll_attempts,
  };

  const ci =
    toml.ci.provider === "jenkins"
      ? {
          provider: toml.ci.provider,
          baseUrl: required(toml.ci.base_url, "ci.base_url"),
          username: required(secrets.JENKINS_USERNAME, "JENKINS_USERNAME"),
          apiKey: required(secrets.JENKINS_API_KEY, "JENKINS_API_KEY"),
          ...ciCommon,
        }
      : { provider: toml.ci.provider, ...ciCommon };

  return applicationConfigurationSchema.parse({
    server: { port: toml.server.port },
    restate: { identityKeys: toml.restate.identity_keys },
    jira,
    coding: {
      provider: toml.coding.provider,
      timeoutMinutes: toml.coding.timeout_minutes,
    },
    workspace: {
      root: toml.workspace.root,
      trustedRepositoryUrlPrefixes: toml.workspace.trusted_repository_url_prefixes,
    },
    ci,
    limits: {
      maxChangedFiles: toml.limits.max_changed_files,
      maxRepairAttempts: toml.limits.max_repair_attempts,
    },
  });
}

export async function loadConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<ApplicationConfiguration> {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const configuredPath = environment.BUG_BOT_CONFIG?.trim() || "bug-bot.toml";
  const path = resolve(cwd, configuredPath);

  let contents: string;
  try {
    contents = await Bun.file(path).text();
  } catch (error) {
    throw new Error(`Failed to read configuration ${path}: ${errorMessage(error)}`);
  }

  let source: object;
  try {
    source = Bun.TOML.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse configuration ${path}: ${errorMessage(error)}`);
  }

  try {
    return parseConfiguration(source, environment);
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(`Invalid configuration ${path}:\n${z.prettifyError(error)}`);

    throw new Error(`Invalid configuration ${path}: ${errorMessage(error)}`);
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
