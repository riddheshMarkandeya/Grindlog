import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exeProcesses, killExe, pidAlive, statusInfo, statusProbe } from "./control";
import { startHost } from "./host";
import { freePort, memoryLogger } from "./testing";

describe("statusInfo", () => {
  test("a mounted API gives the pid, version and connection; refused and starting read as statusProbe's", async () => {
    const port = await freePort();
    expect(await statusInfo(port)).toBe("refused");
    const host = startHost({ port, logger: memoryLogger(), onShutdown: () => undefined });
    try {
      expect(await statusInfo(port)).toBe("starting");
      host.mount(() => Response.json({ connection: "recording", version: "0.1.1", pid: 4321, statsApiOff: false }));
      expect(await statusInfo(port)).toEqual({ pid: 4321, version: "0.1.1", connection: "recording" });
    } finally {
      host.stop();
    }
  });

  test("an older build's status (no version, a connection this one doesn't know) still gives the pid", async () => {
    const port = await freePort();
    const host = startHost({ port, logger: memoryLogger(), onShutdown: () => undefined });
    try {
      host.mount(() => Response.json({ connection: 7, pid: 99 }));
      expect(await statusInfo(port)).toEqual({ pid: 99, version: null });
    } finally {
      host.stop();
    }
  });
});

describe("statusProbe", () => {
  test("nothing on the port is refused, a host before its API mounts is starting, and a mounted API gives the tracker's pid", async () => {
    const port = await freePort();
    expect(await statusProbe(port)).toBe("refused");

    const host = startHost({ port, logger: memoryLogger(), onShutdown: () => undefined });
    try {
      expect(await statusProbe(port)).toBe("starting");
      host.mount(() => Response.json({ connection: "waiting", statsApiOff: false, configProblems: [], configUnknown: false, statsIni: null, expectedWebPort: 49124, version: null, pid: 4321 }));
      expect(await statusProbe(port)).toEqual({ pid: 4321 });
    } finally {
      host.stop();
    }
  });

  test("a tracker of another build (a status shape this one doesn't know) still gives its pid", async () => {
    const port = await freePort();
    const host = startHost({ port, logger: memoryLogger(), onShutdown: () => undefined });
    try {
      host.mount(() => Response.json({ connection: "somethingNew", pid: 99 }));
      expect(await statusProbe(port)).toEqual({ pid: 99 });
    } finally {
      host.stop();
    }
  });

  test("a 200 that isn't a status (another app on the port) is not read as ready", async () => {
    const port = await freePort();
    const host = startHost({ port, logger: memoryLogger(), onShutdown: () => undefined });
    try {
      host.mount(() => new Response("<html>", { status: 200 }));
      expect(await statusProbe(port)).toBe("starting");
    } finally {
      host.stop();
    }
  });
});

test("pidAlive tells this process from one that has exited", async () => {
  expect(pidAlive(process.pid)).toBe(true);
  const child = Bun.spawn([process.execPath, "-e", "0"], { stdout: "ignore", stderr: "ignore" });
  await child.exited;
  expect(pidAlive(child.pid)).toBe(false);
});

test.runIf(process.platform === "win32")("pidAlive counts a process it may not signal (System, pid 4) as alive", () => {
  expect(pidAlive(4)).toBe(true);
});

describe.runIf(process.platform === "win32")("killExe and exeProcesses", () => {
  // Two copies of one same-named exe in different folders, as a hand-run copy beside the install.
  let root: string;
  let a: string;
  let b: string;
  // A differently named exe beside a, as the tray beside the main exe.
  let c: string;
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
    c = join(root, "A", "grindlog-dev-tray.exe");
    copyFileSync(a, c);
  }, 60_000);

  afterAll(async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => p.exited));
    rmSync(root, { recursive: true, force: true });
  });

  test("lists and ends only the processes of that path, and with an arg only those whose command line has it", async () => {
    const aSup = run(a, "--supervisor");
    const aTracker = run(a);
    const bSup = run(b, "--supervisor");
    const cTray = run(c);
    await Bun.sleep(1000);

    const listed = exeProcesses([a]);
    expect(listed.map((p) => p.pid).sort()).toEqual([aSup.pid, aTracker.pid].sort());
    expect(listed.find((p) => p.pid === aSup.pid)?.commandLine).toContain("--supervisor");
    expect(listed.every((p) => p.path.toLowerCase() === a.toLowerCase())).toBe(true);

    // Several paths in one lookup, each process labelled with its own.
    const both = exeProcesses([a, c]);
    expect(both.map((p) => p.pid).sort()).toEqual([aSup.pid, aTracker.pid, cTray.pid].sort());
    expect(both.find((p) => p.pid === cTray.pid)?.path.toLowerCase()).toBe(c.toLowerCase());

    expect(killExe(a, "--supervisor")).toEqual({ kind: "killed" });
    await aSup.exited;
    expect([alive(aTracker), alive(bSup)]).toEqual([true, true]);

    expect(killExe(a)).toEqual({ kind: "killed" });
    await aTracker.exited;
    expect(alive(bSup)).toBe(true);

    expect(killExe(a)).toEqual({ kind: "none" });
    expect(exeProcesses([a])).toEqual([]);
  }, 30_000);

  test("a lookup that fails is reported as failed or thrown, never as nothing running", () => {
    // A quote in the exe's name breaks the WMI query, a real CIM failure that's cheap to cause.
    const broken = join(root, "it's.exe");
    expect(killExe(broken)).toMatchObject({ kind: "failed" });
    expect(() => exeProcesses([broken])).toThrow(/lookup .* failed/);
  }, 30_000);
});
