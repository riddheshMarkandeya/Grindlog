import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { download, type DownloadOptions } from "./download";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-download-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const enc = new TextEncoder();
/** A response streaming `chunks`, then ending (or hanging forever if `hang`). */
const streamed = (chunks: string[], { status = 200, hang = false } = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        if (!hang) c.close();
      },
    }),
    { status },
  );

const dest = () => join(dir, "out.exe");
const opts = (respond: () => Response, extra: Partial<DownloadOptions> = {}): DownloadOptions => ({
  maxBytes: 100,
  logger: memoryLogger(),
  fetch: () => Promise.resolve(respond()),
  ...extra,
});

describe("download over http", () => {
  test("streams the body to the destination", async () => {
    await download({ name: "out.exe", size: 11, url: "https://x/out.exe" }, dest(), opts(() => streamed(["hello ", "world"])));
    expect(readFileSync(dest(), "utf8")).toBe("hello world");
    expect(readdirSync(dir)).toEqual(["out.exe"]);
  });

  test("a non-2xx status fails and leaves nothing behind", async () => {
    await expect(download({ name: "out.exe", size: 3, url: "https://x" }, dest(), opts(() => streamed(["abc"], { status: 404 })))).rejects.toThrow(/404/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a size other than the asset's fails", async () => {
    await expect(download({ name: "out.exe", size: 4, url: "https://x" }, dest(), opts(() => streamed(["abc"])))).rejects.toThrow(/size/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("more than maxBytes streamed fails, whatever the asset claims", async () => {
    await expect(download({ name: "out.exe", size: 3, url: "https://x" }, dest(), opts(() => streamed(["abc", "def"]), { maxBytes: 4 }))).rejects.toThrow(/maxBytes|too large/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("an asset that claims more than maxBytes isn't fetched", async () => {
    let fetched = false;
    const o = opts(() => streamed([]), { maxBytes: 4, fetch: () => ((fetched = true), Promise.resolve(streamed([]))) });
    await expect(download({ name: "out.exe", size: 5, url: "https://x" }, dest(), o)).rejects.toThrow(/too large/);
    expect(fetched).toBe(false);
  });

  test("a stream that stops sending fails after the idle timeout", async () => {
    await expect(download({ name: "out.exe", size: 10, url: "https://x" }, dest(), opts(() => streamed(["ab"], { hang: true }), { idleMs: 50 }))).rejects.toThrow(/idle|timed out/i);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a server that never sends response headers fails after the idle timeout too", async () => {
    // Like real fetch, this one waits until its signal aborts.
    const silent = (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason as Error); });
    });
    await expect(download({ name: "out.exe", size: 10, url: "https://x" }, dest(), { ...opts(() => streamed([])), fetch: silent, idleMs: 50 })).rejects.toThrow(/no response/i);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a body that must start with a prefix and doesn't fails (an HTML error page for a .minisig)", async () => {
    const asset = { name: "a.minisig", size: 15, url: "https://x" };
    await expect(download(asset, dest(), opts(() => streamed(["<!DOCTYPE html>"]), { mustStartWith: "untrusted comment:" }))).rejects.toThrow(/start/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a network failure fails and leaves nothing behind", async () => {
    await expect(download({ name: "out.exe", size: 3, url: "https://x" }, dest(), opts(() => streamed([]), { fetch: () => Promise.reject(new TypeError("fetch failed")) }))).rejects.toThrow(/fetch failed/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("download from a folder feed", () => {
  test("copies the file", async () => {
    const src = mkdtempSync(join(tmpdir(), "grindlog-feed-"));
    try {
      writeFileSync(join(src, "a.exe"), "abc");
      await download({ name: "a.exe", size: 3, url: join(src, "a.exe") }, dest(), opts(() => streamed([])));
      expect(readFileSync(dest(), "utf8")).toBe("abc");
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("a missing file or a size mismatch fails", async () => {
    await expect(download({ name: "a.exe", size: 3, url: join(dir, "nope.exe") }, dest(), opts(() => streamed([])))).rejects.toThrow();
    writeFileSync(join(dir, "a.exe"), "abcd");
    await expect(download({ name: "a.exe", size: 3, url: join(dir, "a.exe") }, dest(), opts(() => streamed([])))).rejects.toThrow(/size/);
    expect(existsSync(dest())).toBe(false);
  });
});
