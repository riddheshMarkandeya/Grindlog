import { describe, expect, test } from "vitest";
import { runtimeInfo } from "./runtime-info";

describe("runtimeInfo", () => {
  test("an unbundled run reports no version, the dev channel, the Windows build and Bun's version", () => {
    expect(runtimeInfo()).toEqual({
      version: null,
      channel: "dev",
      windows: expect.stringMatching(/^\d+\.\d+\.\d+$/) as unknown,
      bun: Bun.version,
    });
  });
});
