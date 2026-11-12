import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { readRequest, readState, REQUEST_FILE, STATE_FILE, writeRequest, writeState } from "./state";

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
