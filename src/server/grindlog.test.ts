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

  test("--open and --quit run the launcher, and win over --supervisor", () => {
    const exe = String.raw`C:\bin\grindlog.exe`;
    expect(mode([exe, "--open"])).toBe("open");
    expect(mode([exe, "--quit"])).toBe("quit");
    expect(mode([exe, "--supervisor", "--open"])).toBe("open");
    expect(mode([exe, "--quit", "--supervisor"])).toBe("quit");
  });

  test("with both launcher flags, --quit wins: ending the app is never turned into starting it", () => {
    expect(mode(["grindlog.exe", "--open", "--quit"])).toBe("quit");
  });

  test("--update runs the updater and wins over --open and --supervisor, but --quit still wins", () => {
    const exe = String.raw`C:\data\update\grindlog-updater.exe`;
    expect(mode([exe, "--update", "--app-dir", String.raw`C:\Program Files\Grindlog`])).toBe("update");
    expect(mode([exe, "--supervisor", "--update"])).toBe("update");
    expect(mode([exe, "--open", "--update"])).toBe("update");
    expect(mode([exe, "--update", "--quit"])).toBe("quit");
  });

  test("the exe's own path never counts as a flag", () => {
    expect(mode(["--open"])).toBe("tracker");
  });
});
