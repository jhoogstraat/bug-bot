import * as restate from "@restatedev/restate-sdk";
import { loadConfiguration } from "./configuration.js";
import { createProductionDependencies } from "../workflow/dependencies.js";
import { createBugFixWorkflow } from "../workflow/workflow.js";

const configuration = await loadConfiguration();
const workflow = createBugFixWorkflow(createProductionDependencies(configuration));

const port = await restate.serve({
  services: [workflow],
  port: configuration.server.port,
  ...(configuration.restate.identityKeys.length > 0
    ? { identityKeys: configuration.restate.identityKeys }
    : {}),
});

console.log(
  JSON.stringify({
    level: "info",
    event: "server.started",
    port,
    jiraMode: configuration.jira.mode,
    codingProvider: configuration.coding.provider,
    ciProvider: configuration.ci.provider,
    runtime: "bun",
    transport: "restate-http2",
  }),
);
