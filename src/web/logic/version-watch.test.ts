import { describe, expect, test } from "vitest";
import { createVersionWatch } from "./version-watch";

describe("createVersionWatch", () => {
  test("the first version is the baseline, and the same version again is no change", () => {
    const changed = createVersionWatch();
    expect(changed("0.2.0")).toBeUndefined();
    expect(changed("0.2.0")).toBeUndefined();
  });

  test("a different version is a change once, then never again, so a failed reload can't loop", () => {
    const changed = createVersionWatch();
    changed("0.2.0");
    expect(changed("0.3.0")).toEqual({ from: "0.2.0" });
    expect(changed("0.3.0")).toBeUndefined();
    expect(changed("0.4.0")).toBeUndefined();
  });

  test("a dev tracker (no version) never asks for a reload", () => {
    const changed = createVersionWatch();
    expect(changed(null)).toBeUndefined();
    expect(changed(null)).toBeUndefined();
  });

  test("a rollback to an older version is a change too", () => {
    const changed = createVersionWatch();
    changed("0.3.0");
    expect(changed("0.2.0")).toEqual({ from: "0.3.0" });
  });
});
