import { describe, expect, test } from "vitest";
import { mode } from "./grindlog";

describe("mode", () => {
  test("--supervisor runs the supervisor, which is what the logon task passes", () => {
    expect(mode([String.raw`C:\bin\grindlog-dev.exe`, "--supervisor"])).toBe("supervisor");
  });

  test("bare runs the tracker, which is how the supervisor starts its child", () => {
    expect(mode([String.raw`C:\bin\grindlog-dev.exe`])).toBe("tracker");
  });

  test("the flag counts anywhere after the exe, and nothing else selects the supervisor", () => {
    expect(mode(["bun", "grindlog.ts", "--supervisor"])).toBe("supervisor");
    expect(mode(["grindlog.exe", "--supervise"])).toBe("tracker");
  });
});
