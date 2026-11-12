import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { runCheck, startSupervisorUpdates, startUpdateChecks, type CheckDeps } from "./checker";
import { disabledReason } from "../../shared/update-key";
import { readState, writeState } from "./state";

// Real minisign fixtures: minisign's own 0.12 asset, its signature, and the key from its README. Its
// trusted comment is minisign's default (timestamp/file), so a run on it exercises the comment check;
// the version contract itself is covered by the CLI-made fixtures below.
const FIX = join(import.meta.dirname, "fixtures");
const KEY_LINE = readFileSync(join(FIX, "jedisct1.pub"), "utf8").split(/\r?\n/)[1] ?? "";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grindlog-checker-"));
  dir = join(root, "update");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface FakeRelease {
  tag: string;
  installer?: { name?: string; body: Buffer | string };
  signature?: { body: string };
}

/** Serves `release` over a fake fetch, GitHub style, honouring If-None-Match with `etag`. */
function fakeGitHub(initial: FakeRelease, etag = 'W/"1"') {
  let release = initial;
  const seen: { url: string; ifNoneMatch: string | null }[] = [];
  let failDownloads = 0;
  const assetsOf = (r: FakeRelease) => {
    const v = r.tag.slice(1);
    const out: { name: string; size: number; browser_download_url: string }[] = [];
    if (r.installer) out.push({ name: r.installer.name ?? `Grindlog-Setup-${v}.exe`, size: Buffer.byteLength(r.installer.body), browser_download_url: `https://dl/${r.installer.name ?? `Grindlog-Setup-${v}.exe`}` });
    if (r.signature) out.push({ name: `Grindlog-Setup-${v}.exe.minisig`, size: Buffer.byteLength(r.signature.body), browser_download_url: `https://dl/Grindlog-Setup-${v}.exe.minisig` });
    return out;
  };
  const fetch = (url: string, init?: RequestInit) => {
    const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");
    seen.push({ url, ifNoneMatch });
    if (url.startsWith("https://api.github.com/")) {
      if (ifNoneMatch === etag) return Promise.resolve(new Response(null, { status: 304 }));
      return Promise.resolve(new Response(JSON.stringify({ tag_name: release.tag, draft: false, prerelease: false, assets: assetsOf(release) }), { headers: { ETag: etag } }));
    }
    if (failDownloads > 0) {
      failDownloads--;
      return Promise.reject(new TypeError("fetch failed"));
    }
    const body = url.endsWith(".minisig") ? release.signature?.body : release.installer?.body;
    return Promise.resolve(new Response(body ?? "", { status: body === undefined ? 404 : 200 }));
  };
  return {
    fetch,
    seen,
    set: (r: FakeRelease) => { release = r; },
    failNextDownloads: (n: number) => { failDownloads = n; },
  };
}

const deps = (fetch: CheckDeps["fetch"], extra: Partial<CheckDeps> = {}): CheckDeps & { logger: ReturnType<typeof memoryLogger> } => ({
  dir,
  running: "0.1.0",
  publicKey: KEY_LINE,
  source: { kind: "http", url: "https://api.github.com/repos/riddheshMarkandeya/Grindlog/releases/latest" },
  fetch,
  now: () => new Date("2026-11-12T10:00:00.000Z"),
  ...extra,
  logger: memoryLogger(),
});

const upstreamInstaller = () => readFileSync(join(FIX, "minisign-0.12-wasm.gz"));
const upstreamSig = () => readFileSync(join(FIX, "minisign-0.12-wasm.gz.minisig"), "utf8");

describe("runCheck on a release signed to the contract (CLI-made fixtures, version 9.9.9)", () => {
  const TEST_KEY = readFileSync(join(FIX, "test.pub"), "utf8").split(/\r?\n/)[1] ?? "";
  const payload = () => readFileSync(join(FIX, "payload.bin"));
  const sig = (name: string) => readFileSync(join(FIX, name), "utf8");

  test.each(["payload.prehashed.minisig", "payload.hashed-suffix.minisig", "payload.legacy.minisig"])("downloads, verifies and records it as available (%s)", async (sigName) => {
    const gh = fakeGitHub({ tag: "v9.9.9", installer: { body: payload() }, signature: { body: sig(sigName) } });
    const d = deps(gh.fetch, { publicKey: TEST_KEY });
    expect(await runCheck(d)).toBe("downloaded");
    expect(readState(dir, memoryLogger())).toMatchObject({
      lastOutcome: "downloaded",
      etag: 'W/"1"',
      available: { version: "9.9.9", file: "Grindlog-Setup-9.9.9.exe", verifiedAt: "2026-11-12T10:00:00.000Z" },
    });
    expect(readdirSync(join(dir, "download")).sort()).toEqual(["Grindlog-Setup-9.9.9.exe", "Grindlog-Setup-9.9.9.exe.minisig"]);
    expect(d.logger.events()).toContain("update/download_done");
  });

  test("the next check (a 304) keeps it without downloading again", async () => {
    const gh = fakeGitHub({ tag: "v9.9.9", installer: { body: payload() }, signature: { body: sig("payload.prehashed.minisig") } });
    await runCheck(deps(gh.fetch, { publicKey: TEST_KEY }));
    const downloads = gh.seen.filter((s) => s.url.startsWith("https://dl/")).length;
    expect(await runCheck(deps(gh.fetch, { publicKey: TEST_KEY }))).toBe("downloaded");
    expect(gh.seen.filter((s) => s.url.startsWith("https://dl/")).length).toBe(downloads);
  });

  test("a signed comment naming another version is a comment mismatch (a replayed signature)", async () => {
    const gh = fakeGitHub({ tag: "v9.9.10", installer: { name: "Grindlog-Setup-9.9.10.exe", body: payload() }, signature: { body: sig("payload.prehashed.minisig") } });
    expect(await runCheck(deps(gh.fetch, { publicKey: TEST_KEY }))).toBe("skipped");
    expect(readState(dir, memoryLogger()).skipped).toEqual([{ version: "9.9.10", reason: "comment_mismatch" }]);
  });

  test("a newer verified release replaces the older download", async () => {
    mkdirSync(join(dir, "download"), { recursive: true });
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.5.0.exe"), "old");
    writeState(dir, memoryLogger(), { available: { version: "0.5.0", file: "Grindlog-Setup-0.5.0.exe", verifiedAt: "x" } });
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.5.0.exe.minisig"), "old");
    const gh = fakeGitHub({ tag: "v9.9.9", installer: { body: payload() }, signature: { body: sig("payload.prehashed.minisig") } });
    expect(await runCheck(deps(gh.fetch, { publicKey: TEST_KEY }))).toBe("downloaded");
    expect(readdirSync(join(dir, "download")).sort()).toEqual(["Grindlog-Setup-9.9.9.exe", "Grindlog-Setup-9.9.9.exe.minisig"]);
  });
});

describe("runCheck", () => {
  test("nothing newer: up to date, with the ETag kept for next time", async () => {
    const gh = fakeGitHub({ tag: "v0.1.0" });
    expect(await runCheck(deps(gh.fetch))).toBe("up_to_date");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "up_to_date", etag: 'W/"1"', checkedAt: "2026-11-12T10:00:00.000Z" });
    expect(await runCheck(deps(gh.fetch))).toBe("up_to_date");
    expect(gh.seen.at(-1)?.ifNoneMatch).toBe('W/"1"');
  });

  test("a signature that doesn't verify skips that version, deletes the download and warns", async () => {
    const tampered = Buffer.from(upstreamInstaller());
    tampered[100] = (tampered[100] ?? 0) ^ 1;
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: tampered }, signature: { body: upstreamSig() } });
    const d = deps(gh.fetch);
    expect(await runCheck(d)).toBe("skipped");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "skipped", skipped: [{ version: "0.2.0", reason: "bad_signature" }], etag: 'W/"1"' });
    expect(readdirSync(join(dir, "download"))).toEqual([]);
    expect(d.logger.lines.find((l) => l.event === "verify_failed")).toMatchObject({ level: "warn", fields: { version: "0.2.0", reason: "bad_signature" } });
  });

  test("a valid signature whose trusted comment isn't the version contract is skipped as a comment mismatch", async () => {
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: upstreamInstaller() }, signature: { body: upstreamSig() } });
    const d = deps(gh.fetch);
    expect(await runCheck(d)).toBe("skipped");
    expect(readState(dir, memoryLogger()).skipped).toEqual([{ version: "0.2.0", reason: "comment_mismatch" }]);
    expect(d.logger.events()).toContain("update/comment_mismatch");
  });

  test("a version skipped before isn't downloaded again", async () => {
    writeState(dir, memoryLogger(), { skipped: [{ version: "0.2.0", reason: "bad_signature" }] });
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: "x" }, signature: { body: "untrusted comment: x" } });
    expect(await runCheck(deps(gh.fetch))).toBe("skipped_before");
    expect(gh.seen.filter((s) => s.url.startsWith("https://dl/"))).toEqual([]);
  });

  test("skipped versions at or below the running one are pruned", async () => {
    writeState(dir, memoryLogger(), { skipped: [{ version: "0.0.5", reason: "bad_signature" }, { version: "0.1.0", reason: "bad_signature" }, { version: "0.3.0", reason: "bad_signature" }] });
    await runCheck(deps(fakeGitHub({ tag: "v0.1.0" }).fetch));
    expect(readState(dir, memoryLogger()).skipped).toEqual([{ version: "0.3.0", reason: "bad_signature" }]);
  });

  test("a failed download retries at the next check: the ETag is cleared, so no 304 hides the release", async () => {
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: upstreamInstaller() }, signature: { body: upstreamSig() } });
    gh.failNextDownloads(1);
    const d = deps(gh.fetch);
    expect(await runCheck(d)).toBe("error");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "error" });
    expect(readState(dir, memoryLogger()).etag).toBeUndefined();
    expect(d.logger.events()).toContain("update/download_failed");
    await runCheck(deps(gh.fetch));
    const apiCalls = gh.seen.filter((s) => s.url.startsWith("https://api.github.com/"));
    expect(apiCalls.at(-1)?.ifNoneMatch).toBeNull();
    // The signature downloads first: it failed on the first check and was fetched again on the second.
    expect(gh.seen.filter((s) => s.url.endsWith(".minisig")).length).toBe(2);
  });

  test("assets not attached yet: an error that retries, with no ETag kept", async () => {
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: "x" } });
    const d = deps(gh.fetch);
    expect(await runCheck(d)).toBe("error");
    expect(readState(dir, memoryLogger()).etag).toBeUndefined();
    expect(d.logger.lines.find((l) => l.event === "assets_missing")?.fields).toEqual({ version: "0.2.0", have: ["Grindlog-Setup-0.2.0.exe"] });
  });

  test("a feed error is logged and recorded, keeping the saved ETag", async () => {
    writeState(dir, memoryLogger(), { etag: 'W/"old"' });
    const d = deps(() => Promise.resolve(new Response("", { status: 500 })));
    expect(await runCheck(d)).toBe("error");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "error", lastError: "HTTP 500", etag: 'W/"old"' });
    expect(d.logger.lines.find((l) => l.event === "check_result")?.fields).toMatchObject({ outcome: "error", status: 500 });
  });

  test("a rate limit logs when it resets", async () => {
    const d = deps(() => Promise.resolve(new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1762950000" } })));
    await runCheck(d);
    expect(d.logger.lines.find((l) => l.event === "rate_limited")?.fields).toEqual({ reset: "2025-11-12T12:20:00.000Z" });
  });

  test("a bad tag is an error naming it", async () => {
    const d = deps(fakeGitHub({ tag: "release-2" }).fetch);
    expect(await runCheck(d)).toBe("error");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "error", lastError: "bad tag release-2" });
  });

  test("an available update whose files are gone (quarantined) is fetched again without the ETag", async () => {
    writeState(dir, memoryLogger(), { etag: 'W/"1"', lastOutcome: "downloaded", available: { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "x" } });
    const gh = fakeGitHub({ tag: "v0.1.0" });
    await runCheck(deps(gh.fetch));
    expect(gh.seen[0]?.ifNoneMatch).toBeNull();
    expect(readState(dir, memoryLogger()).available).toBeUndefined();
  });

  test("once the running version catches up, the stale available update and its files are dropped", async () => {
    writeState(dir, memoryLogger(), { lastOutcome: "downloaded", available: { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "x" } });
    mkdirSync(join(dir, "download"), { recursive: true });
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe"), "x");
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe.minisig"), "x");
    const gh = fakeGitHub({ tag: "v0.2.0" });
    expect(await runCheck(deps(gh.fetch, { running: "0.2.0" }))).toBe("up_to_date");
    expect(readState(dir, memoryLogger()).available).toBeUndefined();
    expect(existsSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe"))).toBe(false);
  });

  test("a 304 still drops an available update the running version has caught up with", async () => {
    writeState(dir, memoryLogger(), { etag: 'W/"1"', lastOutcome: "downloaded", available: { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "x" } });
    mkdirSync(join(dir, "download"), { recursive: true });
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe"), "x");
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe.minisig"), "x");
    const gh = fakeGitHub({ tag: "v0.2.0" });
    expect(await runCheck(deps(gh.fetch, { running: "0.2.0" }))).toBe("up_to_date");
    expect(gh.seen[0]?.ifNoneMatch).toBe('W/"1"');
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "up_to_date" });
    expect(readState(dir, memoryLogger()).available).toBeUndefined();
    expect(existsSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe"))).toBe(false);
  });

  test("a pulled release (latest falls back below the download) is no longer offered", async () => {
    writeState(dir, memoryLogger(), { lastOutcome: "downloaded", available: { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "x" } });
    mkdirSync(join(dir, "download"), { recursive: true });
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe"), "x");
    writeFileSync(join(dir, "download", "Grindlog-Setup-0.2.0.exe.minisig"), "x");
    expect(await runCheck(deps(fakeGitHub({ tag: "v0.1.0" }).fetch))).toBe("up_to_date");
    expect(readState(dir, memoryLogger()).available).toBeUndefined();
    expect(readdirSync(join(dir, "download"))).toEqual([]);
  });

  test("a download that can't be read back for verifying is a recorded error, not a crash", async () => {
    const gh = fakeGitHub({ tag: "v0.2.0", installer: { body: "installer" }, signature: { body: "untrusted comment: x" } });
    const d = deps(gh.fetch, { readFile: () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } });
    expect(await runCheck(d)).toBe("error");
    expect(readState(dir, memoryLogger())).toMatchObject({ lastOutcome: "error", lastError: "download failed for 0.2.0" });
    expect(readState(dir, memoryLogger()).etag).toBeUndefined();
    expect(d.logger.events()).toContain("update/download_failed");
  });
});

describe("disabledReason", () => {
  test("only a prod release build with a baked key checks for updates", () => {
    expect(disabledReason("prod", "0.1.0", "RWQ...")).toBeNull();
    expect(disabledReason("dev", "0.1.0", "RWQ...")).toBe("dev_build");
    expect(disabledReason("prod", null, "RWQ...")).toBe("no_version");
    expect(disabledReason("prod", "0.1.0", null)).toBe("no_key");
  });
});

describe("startUpdateChecks", () => {
  /** A fake timer queue: `advance` fires due callbacks in order. */
  function fakeTimers() {
    let now = 0;
    let seq = 0;
    const queue = new Map<number, { at: number; fn: () => void }>();
    return {
      setTimeout: (fn: () => void, ms: number) => {
        const id = ++seq;
        queue.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (id: number) => { queue.delete(id); },
      async advance(ms: number) {
        const until = now + ms;
        for (;;) {
          const next = [...queue.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
          if (next === undefined) break;
          queue.delete(next[0]);
          now = next[1].at;
          next[1].fn();
          await new Promise((r) => setImmediate(r));
        }
        now = until;
      },
      pending: () => queue.size,
    };
  }

  test("first check after the delay, then every interval plus jitter, one at a time", async () => {
    const timers = fakeTimers();
    const runs: number[] = [];
    let t = 0;
    const handle = startUpdateChecks({
      logger: memoryLogger(),
      check: () => { runs.push(t); return Promise.resolve("up_to_date"); },
      firstDelayMs: 1000,
      intervalMs: 10_000,
      jitterMs: 500,
      random: () => 0.5,
      ...timers,
    });
    t = 999; await timers.advance(999);
    expect(runs).toEqual([]);
    t = 1000; await timers.advance(1);
    expect(runs).toEqual([1000]);
    t = 11_250; await timers.advance(10_250);
    expect(runs).toHaveLength(2);
    handle.stop();
    expect(timers.pending()).toBe(0);
  });

  test("a check that throws is logged and the next one still runs", async () => {
    const timers = fakeTimers();
    const logger = memoryLogger();
    let calls = 0;
    startUpdateChecks({ logger, check: () => { calls++; return Promise.reject(new Error("boom")); }, firstDelayMs: 1, intervalMs: 10, jitterMs: 0, random: () => 0, ...timers });
    await timers.advance(1);
    await timers.advance(10);
    expect(calls).toBe(2);
    expect(logger.events().filter((e) => e === "update/check_crashed")).toHaveLength(2);
  });
});

describe("startSupervisorUpdates", () => {
  const start = (env: Record<string, string>, channel: "prod" | "dev" = "prod") => {
    const logger = memoryLogger();
    const handle = startSupervisorUpdates({ logger, channel, version: "0.1.0", key: KEY_LINE, dir, env });
    handle.stop();
    return logger.lines;
  };

  test("a dev build logs why it doesn't check and starts nothing", () => {
    expect(start({}, "dev")).toEqual([{ level: "info", cat: "update", event: "disabled", fields: { reason: "dev_build" } }]);
  });

  test("a release build checks GitHub, first after 3 minutes", () => {
    expect(start({}).at(0)?.fields).toEqual({ source: { kind: "http", url: "https://api.github.com/repos/riddheshMarkandeya/Grindlog/releases/latest" }, firstDelayMs: 180_000, apply: false });
  });

  test("the first-check override counts only beside a feed override", () => {
    expect(start({ GRINDLOG_UPDATE_FIRST_CHECK_MS: "5" }).at(0)?.fields).toMatchObject({ firstDelayMs: 180_000, apply: false });
    expect(start({ GRINDLOG_UPDATE_FEED: "D:\\feed", GRINDLOG_UPDATE_FIRST_CHECK_MS: "5" }).at(0)?.fields).toEqual({ source: { kind: "folder", dir: "D:\\feed" }, firstDelayMs: 5, apply: false });
  });
});

describe("runCheck during an apply", () => {
  test("does nothing while an apply owns state.json: no fetch, no write", async () => {
    writeState(dir, memoryLogger(), { available: { version: "0.1.1", file: "f", verifiedAt: "t" }, apply: { from: "0.1.0", to: "0.1.1", startedAt: "2026-11-12T09:59:00.000Z", phase: "checking" } });
    const before = readFileSync(join(dir, "state.json"), "utf8");
    const gh = fakeGitHub({ tag: "v0.1.2" });
    const d = deps(gh.fetch);
    expect(await runCheck(d)).toBe("apply_in_progress");
    expect(gh.seen).toEqual([]);
    expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
    expect(d.logger.events()).toContain("update/apply_in_progress");
  });
});
