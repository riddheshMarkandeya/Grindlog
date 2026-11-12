import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { readRequest, REQUEST_FILE, writeRequest, writeState } from "./state";
import { createUpdates } from "./view";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-update-view-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const updates = (running: string | null = "0.1.0", enabled = true) => createUpdates({ dir, logger: memoryLogger(), running, enabled, now: () => NOW });
const AVAILABLE = { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "x" };
const PAGE = "https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.2.0";

describe("view", () => {
  test("a dev build is disabled, whatever the files say", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    expect(updates(null, false).view()).toEqual({ enabled: false, version: null, status: "disabled", available: null, skipped: null, autoApply: true, installRequested: false, checkedAt: null, lastApply: null });
  });

  test("before the first check it's not checked, with auto-apply on by default", () => {
    expect(updates().view()).toEqual({ enabled: true, version: "0.1.0", status: "not_checked", available: null, skipped: null, autoApply: true, installRequested: false, checkedAt: null, lastApply: null });
  });

  test("up to date after a check", () => {
    writeState(dir, memoryLogger(), { checkedAt: "2026-11-12T10:00:00.000Z", lastOutcome: "up_to_date" });
    expect(updates().view()).toMatchObject({ status: "up_to_date", checkedAt: "2026-11-12T10:00:00.000Z" });
  });

  test("a verified download is ready, with its page built from the version", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    expect(updates().view()).toMatchObject({ status: "ready", available: { version: "0.2.0", page: PAGE } });
  });

  test("a download no newer than what runs isn't offered", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    expect(updates("0.2.0").view()).toMatchObject({ status: "up_to_date", available: null });
  });

  test("the newest skipped version above the running one is shown; ready wins over it", () => {
    const skipped = [{ version: "0.1.0", reason: "bad_signature" }, { version: "0.3.0", reason: "bad_signature" }, { version: "0.2.5", reason: "comment_mismatch" }];
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "skipped", skipped });
    expect(updates().view()).toMatchObject({ status: "skipped", skipped: "0.3.0" });
    writeState(dir, memoryLogger(), { available: { ...AVAILABLE, version: "0.4.0" } });
    expect(updates().view()).toMatchObject({ status: "ready", skipped: "0.3.0" });
  });

  test("a failed check is an error", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "error", lastError: "HTTP 500" });
    expect(updates().view()).toMatchObject({ status: "error" });
  });

  test("an install asked for the available version reads as requested; one for an older version doesn't", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    writeRequest(dir, memoryLogger(), { install: "0.1.5" });
    expect(updates().view().installRequested).toBe(false);
    writeRequest(dir, memoryLogger(), { install: "0.2.0" });
    expect(updates().view().installRequested).toBe(true);
  });
});

describe("install", () => {
  test("asks for the available version, logging the request", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    const logger = memoryLogger();
    expect(createUpdates({ dir, logger, running: "0.1.0", enabled: true }).install("0.2.0")).toBe("ok");
    expect(readRequest(dir, memoryLogger())).toEqual({ v: 1, autoApply: true, install: "0.2.0" });
    expect(logger.lines).toEqual([{ level: "info", cat: "update", event: "request", fields: { kind: "install", version: "0.2.0" } }]);
  });

  test("any version but the available one is a conflict and writes nothing", () => {
    expect(updates().install("0.2.0")).toBe("conflict");
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    expect(updates().install("0.3.0")).toBe("conflict");
    expect(updates(null, false).install("0.2.0")).toBe("conflict");
    expect(readRequest(dir, memoryLogger())).toEqual({ v: 1, autoApply: true });
  });

  test("a failed write is a failure", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "downloaded", available: AVAILABLE });
    // A folder where request.json goes makes the write fail.
    mkdirSync(join(dir, REQUEST_FILE));
    expect(updates().install("0.2.0")).toBe("failed");
  });
});

describe("setAutoApply", () => {
  test("records the choice and logs it", () => {
    const logger = memoryLogger();
    expect(createUpdates({ dir, logger, running: "0.1.0", enabled: true }).setAutoApply(false)).toBe(true);
    expect(readRequest(dir, memoryLogger()).autoApply).toBe(false);
    expect(logger.lines.at(-1)).toEqual({ level: "info", cat: "update", event: "request", fields: { kind: "auto_apply", on: false } });
  });
});

describe("view's lastApply", () => {
  const HOUR = 60 * 60 * 1000;
  const last = (outcome: string, ago: number, reason?: string) =>
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "up_to_date", lastApply: { from: "0.1.0", to: "0.2.0", outcome, ...(reason ? { reason } : {}), at: new Date(NOW - ago).toISOString() } });

  test("an update shows for a day while the new version runs, with its page", () => {
    last("updated", 23 * HOUR);
    expect(updates("0.2.0").view().lastApply).toEqual({ outcome: "updated", from: "0.1.0", to: "0.2.0", reason: null, at: new Date(NOW - 23 * HOUR).toISOString(), page: PAGE });
    last("updated", 25 * HOUR);
    expect(updates("0.2.0").view().lastApply).toBeNull();
  });

  test.each(["rolled_back", "rollback_failed"])("%s shows for a week while the old version runs", (outcome) => {
    last(outcome, 6 * 24 * HOUR, "low_disk");
    expect(updates("0.1.0").view().lastApply).toMatchObject({ outcome, reason: "low_disk" });
    expect(updates("0.2.0").view().lastApply).toBeNull();
    last(outcome, 8 * 24 * HOUR);
    expect(updates("0.1.0").view().lastApply).toBeNull();
  });

  test("an update that may not have finished shows for a week while the new version runs", () => {
    last("unhealthy", 2 * 24 * HOUR);
    expect(updates("0.2.0").view().lastApply).toMatchObject({ outcome: "unhealthy" });
  });

  test.each(["not_started", "interrupted", "some_future_outcome"])("%s shows nothing", (outcome) => {
    last(outcome, HOUR);
    expect(updates("0.1.0").view().lastApply).toBeNull();
    expect(updates("0.2.0").view().lastApply).toBeNull();
  });

  test("a version skipped because its update failed isn't called a signature failure", () => {
    writeState(dir, memoryLogger(), { checkedAt: "t", lastOutcome: "up_to_date", skipped: [{ version: "0.2.0", reason: "health_check_failed" }, { version: "0.1.5", reason: "bad_signature" }] });
    expect(updates().view()).toMatchObject({ status: "skipped", skipped: "0.1.5" });
    writeState(dir, memoryLogger(), { skipped: [{ version: "0.2.0", reason: "installer_failed" }] });
    expect(updates().view()).toMatchObject({ status: "up_to_date", skipped: null });
  });
});
