import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { checkAllowedAt, checkPending, readRequest, readStartFailure, readState, REQUEST_FILE, START_FAILURE_FILE, STATE_FILE, writeRequest, writeStartFailure, writeState } from "./state";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-update-state-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const raw = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("state.json", () => {
  test("a missing file reads as never checked, quietly", () => {
    const logger = memoryLogger();
    expect(readState(dir, logger)).toEqual({ v: 1, skipped: [] });
    expect(logger.lines).toEqual([]);
  });

  test("written fields read back", () => {
    const logger = memoryLogger();
    const available = { version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe", verifiedAt: "2026-11-12T10:00:00.000Z" };
    expect(writeState(dir, logger, { checkedAt: "2026-11-12T10:00:00.000Z", lastOutcome: "downloaded", available })).toBe(true);
    expect(readState(dir, logger)).toEqual({ v: 1, skipped: [], checkedAt: "2026-11-12T10:00:00.000Z", lastOutcome: "downloaded", available });
  });

  test("a write keeps fields this version doesn't know (a newer updater's, read by rolled-back code)", () => {
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: [], phase: "applying", to: "0.3.0" }));
    writeState(dir, memoryLogger(), { lastOutcome: "up_to_date" });
    expect(raw(STATE_FILE)).toEqual({ v: 1, skipped: [], phase: "applying", to: "0.3.0", lastOutcome: "up_to_date" });
  });

  test("nested objects keep unknown fields too", () => {
    const available = { version: "0.3.0", file: "Grindlog-Setup-0.3.0.exe", verifiedAt: "x", reverifiedAt: "y" };
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: [{ version: "0.4.0", reason: "bad_signature", at: "z" }], available }));
    writeState(dir, memoryLogger(), { lastOutcome: "downloaded" });
    expect(raw(STATE_FILE)).toMatchObject({ available, skipped: [{ version: "0.4.0", reason: "bad_signature", at: "z" }] });
  });

  test.each([{ available: { version: "1.2", file: "f", verifiedAt: "x" } }, { skipped: [{ version: "../x", reason: "r" }] }])("a version that isn't x.y.z[-suffix] makes the file unreadable (%o)", (bad) => {
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: [], ...bad }));
    const logger = memoryLogger();
    expect(readState(dir, logger)).toEqual({ v: 1, skipped: [] });
    expect(logger.events()).toEqual(["update/state_unreadable"]);
  });

  test("a field set to undefined is removed", () => {
    writeState(dir, memoryLogger(), { etag: "W/\"abc\"" });
    writeState(dir, memoryLogger(), { etag: undefined });
    expect(raw(STATE_FILE)).toEqual({ v: 1, skipped: [] });
  });

  test("a corrupt file reads as the default and warns once per process", () => {
    writeFileSync(join(dir, STATE_FILE), "{not json");
    const logger = memoryLogger();
    expect(readState(dir, logger)).toEqual({ v: 1, skipped: [] });
    readState(dir, logger);
    expect(logger.events()).toEqual(["update/state_unreadable"]);
  });

  test("a file of the wrong shape reads as the default", () => {
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: "no" }));
    expect(readState(dir, memoryLogger())).toEqual({ v: 1, skipped: [] });
  });

  test("a corrupt file is replaced by the next write", () => {
    writeFileSync(join(dir, STATE_FILE), "{not json");
    writeState(dir, memoryLogger(), { lastOutcome: "error", lastError: "offline" });
    expect(raw(STATE_FILE)).toEqual({ v: 1, skipped: [], lastOutcome: "error", lastError: "offline" });
  });

  test("a failed write logs and returns false", () => {
    const logger = memoryLogger();
    writeFileSync(join(dir, "a-file"), "");
    expect(writeState(join(dir, "a-file"), logger, { lastOutcome: "error" })).toBe(false);
    expect(logger.events()).toEqual(["update/state_write_failed"]);
  });
});

describe("apply and lastApply", () => {
  const apply = { from: "0.1.0", to: "0.1.1", startedAt: "2026-11-12T10:00:00.000Z", phase: "installing" };

  test("an apply and a last-apply outcome read back", () => {
    const logger = memoryLogger();
    const lastApply = { from: "0.0.9", to: "0.1.0", outcome: "rolled_back", reason: "health_check_failed", at: "2026-11-11T10:00:00.000Z" };
    writeState(dir, logger, { apply, lastApply });
    expect(readState(dir, logger)).toMatchObject({ apply, lastApply });
  });

  test("a phase or outcome from a newer version survives a read and a write (not an enum, so the file isn't wiped)", () => {
    const logger = memoryLogger();
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: [{ version: "0.2.0", reason: "r" }], apply: { ...apply, phase: "warp_drive" }, lastApply: { from: "0.1.0", to: "0.1.1", outcome: "teleported", at: "x" } }));
    expect(readState(dir, logger).apply?.phase).toBe("warp_drive");
    writeState(dir, logger, { checkedAt: "now" });
    expect(raw(STATE_FILE)).toMatchObject({ skipped: [{ version: "0.2.0" }], apply: { phase: "warp_drive" }, lastApply: { outcome: "teleported" } });
    expect(logger.events()).toEqual([]);
  });

  test.each([{ apply: { ...apply, to: "../evil" } }, { lastApply: { from: "1.2", to: "0.1.1", outcome: "updated", at: "x" } }])("a non-version in apply or lastApply makes the file unreadable (%o)", (bad) => {
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ v: 1, skipped: [], ...bad }));
    const logger = memoryLogger();
    expect(readState(dir, logger)).toEqual({ v: 1, skipped: [] });
    expect(logger.events()).toEqual(["update/state_unreadable"]);
  });
});

describe("start-failure.json", () => {
  const apply = { from: "0.1.0", to: "0.1.1", startedAt: "2026-11-12T10:00:00.000Z", phase: "checking" };
  const failure = { version: "0.1.1", reason: "low_disk", freeBytes: 1_000_000, needBytes: 500_000_000, at: "2026-11-12T10:01:00.000Z" };

  test("a failure written by this apply's version after it started is read back", () => {
    const logger = memoryLogger();
    expect(writeStartFailure(dir, logger, failure)).toBe(true);
    expect(raw(START_FAILURE_FILE)).toEqual({ v: 1, ...failure });
    expect(readStartFailure(dir, apply, logger)).toMatchObject(failure);
  });

  test("a failure from before the apply started, or from another version, is ignored", () => {
    const logger = memoryLogger();
    writeStartFailure(dir, logger, { ...failure, at: "2026-11-12T09:59:59.000Z" });
    expect(readStartFailure(dir, apply, logger)).toBeUndefined();
    writeStartFailure(dir, logger, { ...failure, version: "0.1.0" });
    expect(readStartFailure(dir, apply, logger)).toBeUndefined();
  });

  test("a missing file is no failure, quietly", () => {
    const logger = memoryLogger();
    expect(readStartFailure(dir, apply, logger)).toBeUndefined();
    expect(logger.lines).toEqual([]);
  });
});

describe("request.json", () => {
  test("a missing file means auto-apply on and no install asked for", () => {
    expect(readRequest(dir, memoryLogger())).toEqual({ v: 1, autoApply: true });
  });

  test("an install request for something that isn't a version reads as the default", () => {
    writeFileSync(join(dir, REQUEST_FILE), JSON.stringify({ v: 1, autoApply: false, install: "1.2" }));
    expect(readRequest(dir, memoryLogger())).toEqual({ v: 1, autoApply: true });
  });

  test("written choices read back, and a later write keeps the other field", () => {
    const logger = memoryLogger();
    writeRequest(dir, logger, { autoApply: false });
    writeRequest(dir, logger, { install: "0.2.0" });
    expect(readRequest(dir, logger)).toEqual({ v: 1, autoApply: false, install: "0.2.0" });
    expect(raw(REQUEST_FILE)).toEqual({ v: 1, autoApply: false, install: "0.2.0" });
  });
});

describe("checkPending", () => {
  const NOW = Date.parse("2026-11-18T12:00:00.000Z");
  const req = (checkRequestedAt?: string) => ({ v: 1 as const, autoApply: true, ...(checkRequestedAt === undefined ? {} : { checkRequestedAt }) });
  const st = (checkedAt?: string) => ({ v: 1 as const, skipped: [], ...(checkedAt === undefined ? {} : { checkedAt }) });

  test("no request: not pending", () => {
    expect(checkPending(req(), st("2026-11-18T11:00:00.000Z"), NOW)).toBe(false);
  });
  test("a request newer than the last check is pending", () => {
    expect(checkPending(req("2026-11-18T11:59:50.000Z"), st("2026-11-18T11:00:00.000Z"), NOW)).toBe(true);
  });
  test("a request before never-checked is pending", () => {
    expect(checkPending(req("2026-11-18T11:59:50.000Z"), st(), NOW)).toBe(true);
  });
  test("a request during an apply isn't pending: no check runs to answer it", () => {
    const applying = { ...st("2026-11-18T11:00:00.000Z"), apply: { from: "1.0.0", to: "1.1.0", startedAt: "2026-11-18T11:59:00.000Z", phase: "waiting" } };
    expect(checkPending(req("2026-11-18T11:59:50.000Z"), applying, NOW)).toBe(false);
  });
  test("a check started after the request answers it", () => {
    expect(checkPending(req("2026-11-18T11:59:50.000Z"), st("2026-11-18T11:59:52.000Z"), NOW)).toBe(false);
  });
  test("a check started at the same instant answers it", () => {
    expect(checkPending(req("2026-11-18T11:59:50.000Z"), st("2026-11-18T11:59:50.000Z"), NOW)).toBe(false);
  });
  test("a request 10 minutes old has expired", () => {
    expect(checkPending(req("2026-11-18T11:50:00.000Z"), st(), NOW)).toBe(false);
    expect(checkPending(req("2026-11-18T11:50:00.001Z"), st(), NOW)).toBe(true);
  });
  test("a request in the future (clock moved back) isn't pending", () => {
    expect(checkPending(req("2026-11-18T13:00:00.000Z"), st(), NOW)).toBe(false);
  });
  test("a garbled request isn't pending", () => {
    expect(checkPending(req("soon"), st(), NOW)).toBe(false);
  });
});

describe("checkAllowedAt", () => {
  const NOW = Date.parse("2026-11-18T12:00:00.000Z");
  const st = (finishedAt?: string) => ({ v: 1 as const, skipped: [], ...(finishedAt === undefined ? {} : { finishedAt }) });

  test("never finished a check: no cooldown", () => {
    expect(checkAllowedAt(st(), NOW)).toBeNull();
  });
  test("finished 20 s ago: allowed 60 s after it finished", () => {
    expect(checkAllowedAt(st("2026-11-18T11:59:40.000Z"), NOW)).toBe("2026-11-18T12:00:40.000Z");
  });
  test("finished a minute ago: no cooldown", () => {
    expect(checkAllowedAt(st("2026-11-18T11:59:00.000Z"), NOW)).toBeNull();
  });
  test("finished in the future (clock moved back): no cooldown", () => {
    expect(checkAllowedAt(st("2026-11-18T12:05:00.000Z"), NOW)).toBeNull();
  });
  test("garbled: no cooldown", () => {
    expect(checkAllowedAt(st("later"), NOW)).toBeNull();
  });
});
