import * as restate from "@restatedev/restate-sdk";
import { loadEnvironment } from "./environment.js";
import { BugFixWorkflow } from "../workflow/workflow.js";

const env = loadEnvironment();

const port = await restate.serve({
  services: [BugFixWorkflow],
  port: env.PORT,
  ...(env.RESTATE_IDENTITY_KEYS ? { identityKeys: env.RESTATE_IDENTITY_KEYS } : {}),
});

console.log(
  JSON.stringify({
    level: "info",
    event: "server.started",
    port,
    adapterMode: env.ADAPTER_MODE,
    harnessMode: env.HARNESS_MODE,
    runtime: "bun",
    transport: "restate-http2",
  }),
);
