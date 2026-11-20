import { afterEach, describe, expect, test, vi } from "vitest";
import { retryWhileLocked } from "./steps";

const fail = (code: string) => Object.assign(new Error(code), { code });

describe("retryWhileLocked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("retries while the file is held, then says so once it goes through", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let tries = 0;
    const result = await retryWhileLocked("Reading x.exe", () => {
      tries++;
      if (tries === 1) throw fail("EBUSY");
      return "ok";
    });
    expect([result, tries]).toEqual(["ok", 2]);
    expect(log).toHaveBeenCalledWith("Reading x.exe: it was held (EBUSY); done after 2 tries.");
  });

  test("any other error is rethrown at once, with no line printed", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let tries = 0;
    await expect(
      retryWhileLocked("Reading x.exe", () => {
        tries++;
        throw fail("ENOENT");
      }),
    ).rejects.toThrow("ENOENT");
    expect(tries).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });
});
