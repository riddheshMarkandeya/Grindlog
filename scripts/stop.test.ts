import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { identity } from "../src/server/paths";
import { describeStopResult, killExe, stopTracker } from "./stop";

describe("describeStopResult", () => {
  test("202 means it's stopping", () => {
    expect(describeStopResult({ kind: "status", status: 202 })).toEqual({ message: "Grindlog Dev is stopping.", exitCode: 0 });
  });

  test("a refused connection means nothing is running", () => {
    expect(describeStopResult({ kind: "refused" })).toEqual({ message: "Grindlog Dev is not running.", exitCode: 1 });
  });

  test("a reset after sending most likely means it stopped before answering", () => {
    expect(describeStopResult({ kind: "reset" })).toMatchObject({ exitCode: 0 });
    expect(describeStopResult({ kind: "reset" }).message).toMatch(/probably stopping/);
  });

  test("any other status, or another error, is a failure that says what came back", () => {
    expect(describeStopResult({ kind: "status", status: 403 })).toEqual({ message: "Stop request failed: HTTP 403.", exitCode: 1 });
    expect(describeStopResult({ kind: "error", message: "boom" })).toEqual({ message: "Stop request failed: boom", exitCode: 1 });
  });
});

describe("stopTracker", () => {
  // Tests run unbundled, so as the dev channel.
  const INSTALLED = identity("dev").port;

  test("nothing on the installed port: a supervisor sleeping before a restart is ended, so it can't bring the tracker back", async () => {
    const endSupervisor = vi.fn(() => true);
    const result = await stopTracker(INSTALLED, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor });
    expect(endSupervisor).toHaveBeenCalledOnce();
    expect(result).toEqual({ message: "Grindlog Dev wasn't running; ended its supervisor, which was waiting to restart it.", exitCode: 0, notRunning: true });
  });

  test("no supervisor either: not running", async () => {
    const result = await stopTracker(INSTALLED, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor: () => false });
    expect(result).toEqual({ message: "Grindlog Dev is not running.", exitCode: 1, notRunning: true });
  });

  test("another port is a dev run, which has no supervisor, so the installed one is left alone", async () => {
    const endSupervisor = vi.fn(() => true);
    const result = await stopTracker(49101, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor });
    expect(endSupervisor).not.toHaveBeenCalled();
    expect(result.notRunning).toBe(true);
  });

  test("the prod port belongs to a friend's install, so a dev stop never ends its processes", async () => {
    const endSupervisor = vi.fn(() => true);
    await stopTracker(49100, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor });
    expect(endSupervisor).not.toHaveBeenCalled();
  });

  test("a stopping tracker is not 'not running'", async () => {
    const result = await stopTracker(INSTALLED, false, { request: () => Promise.resolve({ kind: "status", status: 202 }), endSupervisor: () => true });
    expect(result).toEqual({ message: "Grindlog Dev is stopping.", exitCode: 0, notRunning: false });
  });
});

describe.runIf(process.platform === "win32")("killExe", () => {
  // Two copies of one same-named exe in different folders, as a hand-run copy beside the install.
  let root: string;
  let a: string;
  let b: string;
  const procs: Bun.Subprocess[] = [];
  const run = (exe: string, ...args: string[]) => {
    const p = Bun.spawn([exe, ...args], { stdout: "ignore", stderr: "ignore" });
    procs.push(p);
    return p;
  };
  const alive = (p: Bun.Subprocess) => p.exitCode === null && p.signalCode === null;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "grindlog-kill-"));
    writeFileSync(join(root, "sleeper.ts"), "await Bun.sleep(60_000);");
    a = join(root, "A", "grindlog-dev.exe");
    b = join(root, "B", "grindlog-dev.exe");
    mkdirSync(join(root, "A"));
    mkdirSync(join(root, "B"));
    const built = Bun.spawnSync([process.execPath, "build", "--compile", join(root, "sleeper.ts"), "--outfile", a], { stdout: "ignore", stderr: "pipe" });
    if (built.exitCode !== 0) throw new Error(built.stderr.toString());
    copyFileSync(a, b);
  }, 60_000);

  afterAll(async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => p.exited));
    rmSync(root, { recursive: true, force: true });
  });

  test("ends only the processes of that path, and with an arg only those whose command line has it", async () => {
    const aSup = run(a, "--supervisor");
    const aTracker = run(a);
    const bSup = run(b, "--supervisor");
    await Bun.sleep(1000);

    expect(killExe(a, "--supervisor")).toBe(true);
    await aSup.exited;
    expect([alive(aTracker), alive(bSup)]).toEqual([true, true]);

    expect(killExe(a)).toBe(true);
    await aTracker.exited;
    expect(alive(bSup)).toBe(true);

    expect(killExe(a)).toBe(false);
  }, 30_000);
});
