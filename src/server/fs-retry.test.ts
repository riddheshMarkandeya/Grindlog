import { describe, expect, test } from "vitest";
import { renameRetry } from "./fs-retry";
import { memoryLogger } from "./testing";

const fsError = (code: string) => Object.assign(new Error(code), { code });

/** A rename that throws each of `codes` in turn, then succeeds; records its calls. */
function flaky(...codes: string[]) {
  const calls: [string, string][] = [];
  const rename = (from: string, to: string) => {
    calls.push([from, to]);
    const code = codes.shift();
    if (code !== undefined) throw fsError(code);
  };
  return { rename, calls };
}

function clock() {
  let t = 0;
  return { now: () => t, sleepSync: (ms: number) => { t += ms; } };
}

describe("renameRetry", () => {
  test("renames once and logs nothing when the first try works", () => {
    const logger = memoryLogger();
    const { rename, calls } = flaky();
    renameRetry("a.partial", "a", { logger, rename, ...clock() });
    expect(calls).toEqual([["a.partial", "a"]]);
    expect(logger.lines).toEqual([]);
  });

  test.each(["EPERM", "EBUSY", "EACCES"])("retries a file held by another process (%s) and logs that it did", (code) => {
    const logger = memoryLogger();
    const { rename, calls } = flaky(code, code);
    renameRetry("a.partial", "a", { logger, rename, ...clock() });
    expect(calls).toHaveLength(3);
    expect(logger.lines).toEqual([{ level: "info", cat: "fs", event: "rename_retried", fields: { to: "a", tries: 3, code } }]);
  });

  test("rethrows another error at once", () => {
    const { rename, calls } = flaky("ENOENT");
    expect(() => { renameRetry("a.partial", "a", { logger: memoryLogger(), rename, ...clock() }); }).toThrow("ENOENT");
    expect(calls).toHaveLength(1);
  });

  test("gives up after the timeout and rethrows the last error", () => {
    const { rename, calls } = flaky(...Array<string>(100).fill("EBUSY"));
    expect(() => { renameRetry("a.partial", "a", { logger: memoryLogger(), rename, timeoutMs: 500, ...clock() }); }).toThrow("EBUSY");
    expect(calls).toHaveLength(6); // t = 0, 100, ... 500
  });
});
