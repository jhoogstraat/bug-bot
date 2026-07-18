import * as restate from "@restatedev/restate-sdk";
import { startWebhookApi } from "./webhook-api.js";
import { loadEnvironment } from "./environment.js";
import { createBugFixQueueRestateService } from "../entrypoints/bugfix-queue.restate-service.js";
import { createJiraWebhookIngressService } from "../entrypoints/jira-webhook.restate-service.js";
import { jira } from "../workflows/bugfix/dependencies.js";
import { BugFixWorkflow } from "../workflows/bugfix/workflow.js";

const env = loadEnvironment();
const queue = createBugFixQueueRestateService(jira, BugFixWorkflow);
const jiraWebhook = createJiraWebhookIngressService(BugFixWorkflow);
const restateDefinitions = [BugFixWorkflow, queue, jiraWebhook];

const port = await restate.serve({
  services: restateDefinitions,
  port: env.PORT,
  ...(env.RESTATE_IDENTITY_KEYS ? { identityKeys: env.RESTATE_IDENTITY_KEYS } : {}),
});

const webhookApi = startWebhookApi({
  port: env.APP_PORT,
  restateIngressUrl: env.RESTATE_INGRESS_URL,
  ...(env.WEBHOOK_SIGNING_SECRET ? { signingSecret: env.WEBHOOK_SIGNING_SECRET } : {}),
  services: {
    jira: jiraWebhook,
  },
});

console.log(
  JSON.stringify({
    level: "info",
    event: "server.started",
    port,
    webhookApiPort: webhookApi.port,
    adapterMode: env.ADAPTER_MODE,
    harnessMode: env.HARNESS_MODE,
    runtime: "bun",
    transport: "restate-http2",
  }),
);
