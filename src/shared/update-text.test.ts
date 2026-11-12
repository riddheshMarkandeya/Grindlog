import { describe, expect, test } from "vitest";
import type { UpdateResponse } from "./schemas/responses";
import { lastApplyText } from "./update-text";

const last = (outcome: NonNullable<UpdateResponse["lastApply"]>["outcome"], reason: string | null = null): NonNullable<UpdateResponse["lastApply"]> => ({ outcome, from: "0.1.0", to: "0.2.0", reason, at: "t", page: "p" });

describe("lastApplyText", () => {
  test.each<[NonNullable<UpdateResponse["lastApply"]>, string]>([
    [last("updated"), "Updated to 0.2.0"],
    [last("rolled_back", "health_check_failed"), "Update 0.2.0 didn't start, so Grindlog went back to 0.1.0"],
    [last("rollback_failed", "installer_failed"), "Update 0.2.0 didn't start, so Grindlog went back to 0.1.0"],
    [last("rolled_back", "low_disk"), "Update 0.2.0 needed more disk space, so Grindlog went back to 0.1.0"],
    [last("unhealthy", "health_check_failed"), "Update 0.2.0 may not have finished; reinstall if something's wrong"],
  ])("%j says %s", (l, text) => {
    expect(lastApplyText(l)).toBe(text);
  });
});
