import { describe, expect, test } from "vitest";
import type { UpdateResponse } from "./schemas/responses";
import { RELEASES_LATEST_PAGE } from "./release";
import { lastApplyLink, lastApplyText } from "./update-text";

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

describe("lastApplyLink", () => {
  test.each<[NonNullable<UpdateResponse["lastApply"]>, { text: string; url: string } | null]>([
    [last("updated"), { text: "What changed in 0.2.0", url: "p" }],
    [last("unhealthy", "health_check_failed"), { text: "Latest release", url: RELEASES_LATEST_PAGE }],
    [last("rolled_back", "health_check_failed"), null],
    [last("rollback_failed", "installer_failed"), null],
  ])("%j links %j", (l, link) => {
    expect(lastApplyLink(l)).toEqual(link);
  });

  test("the unhealthy link is the repo's latest-release page", () => {
    expect(lastApplyLink(last("unhealthy"))?.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest$/);
  });
});
