import { describe, expect, it } from "bun:test";
import { workflowId } from "../src/workflows/bugfix/workflow.js";
describe("workflow identity", () => {
  it("is stable per ticket", () => {
    expect(workflowId("ABC-123")).toBe("bugfix/ABC-123");
    expect(workflowId("ABC-123")).toBe(workflowId("ABC-123"));
  });

  it("changes for a different ticket", () =>
    expect(workflowId("ABC-124")).not.toBe(workflowId("ABC-123")));
});
