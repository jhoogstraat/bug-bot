import type { CompactCiFailure } from "../../../domain/ci.js";

export type RepairDecision = { action: "repair" } | { action: "human_required"; reason: string };

export interface RepairHistory {
  repairAttempt: number;
  maxRepairAttempts: number;
  lastFailureFingerprint?: string;
  lastCommitAtFailure?: string;
}

export function decideRepair(
  history: RepairHistory,
  failure: CompactCiFailure,
  currentCommitSha: string,
): RepairDecision {
  if (failure.category === "infrastructure" || failure.category === "timeout") {
    return {
      action: "human_required",
      reason: `CI failure is ${failure.category}; product code will not be changed`,
    };
  }

  if (history.repairAttempt >= history.maxRepairAttempts)
    return { action: "human_required", reason: "Maximum repair attempts reached" };

  if (
    history.lastFailureFingerprint === failure.fingerprint &&
    history.lastCommitAtFailure === currentCommitSha
  ) {
    return {
      action: "human_required",
      reason: "The same failure repeated without a meaningful code change",
    };
  }

  return { action: "repair" };
}
