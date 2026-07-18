import { describe, expect, it } from "bun:test";
import type { CompactCiFailure } from "../src/domain/ci.js";
import { decideRepair, type RepairHistory } from "../src/workflows/bugfix/tasks/repair-policy.js";

const history: RepairHistory = {
  repairAttempt: 0,
  maxRepairAttempts: 3,
};

const failure = (category: CompactCiFailure["category"], fingerprint = "f"): CompactCiFailure => ({
  provider: "jenkins",
  buildId: "1",
  category,
  failedTests: [],
  compilerErrors: [],
  logExcerpt: "",
  removedLineCount: 0,
  fingerprint,
});

describe("repair policy", () => {
  it("repairs code failures", () =>
    expect(decideRepair(history, failure("test"), "a").action).toBe("repair"));

  it("stops for infrastructure", () =>
    expect(decideRepair(history, failure("infrastructure"), "a").action).toBe("human_required"));

  it("stops repeated unchanged failures", () =>
    expect(
      decideRepair(
        { ...history, lastFailureFingerprint: "f", lastCommitAtFailure: "a" },
        failure("test"),
        "a",
      ).action,
    ).toBe("human_required"));

  it("stops at the repair limit", () =>
    expect(decideRepair({ ...history, repairAttempt: 3 }, failure("test"), "a").action).toBe(
      "human_required",
    ));
});
