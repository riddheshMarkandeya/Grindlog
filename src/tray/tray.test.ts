// Live: builds the real tray exe and checks the stdin-close half of the quit protocol, which only
// a real process and pipe can show. Skipped, with the reason logged, where there is no csc.exe.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildTray, findCsc } from "../../scripts/build-tray";

const csc = findCsc();
if (csc === null) console.log("tray.test: skipped, no csc.exe from .NET Framework 4.8");

describe.skipIf(csc === null)("the tray exe", () => {
  let dir: string;
  let exe: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-tray-test-"));
    exe = join(dir, "grindlog-test-tray.exe");
    buildTray({ out: exe, channel: "dev", version: "0.0.1" });
  }, 60_000);
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  const start = () =>
    Bun.spawn([exe, "--port", "1", "--name", "Grindlog Test", "--logs", dir, "--version", "0.0.1", "--channel", "dev"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

  /** Reads stdout until a line with this event shows up, and returns every line read so far. */
  async function readUntil(stdout: ReadableStream<Uint8Array>, event: string): Promise<Record<string, unknown>[]> {
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        buf = buf.slice(nl + 1);
      }
      if (lines.some((l) => l.event === event)) return lines;
    }
    return lines;
  }

  test("logs started, then exits 3 with stdin_closed once stdin closes", async () => {
    const tray = start();
    const reader = tray.stdout;
    const iter = readUntil(reader, "stdin_closed");
    // Give it time to show the icon, so the close lands on a running message loop.
    await Bun.sleep(1000);
    await tray.stdin.end();
    const code = await Promise.race([tray.exited, Bun.sleep(5000).then(() => "timeout" as const)]);
    if (code === "timeout") tray.kill();
    expect(code).toBe(3);
    const lines = await iter;
    expect(lines[0]).toMatchObject({ event: "started", pid: tray.pid, version: "0.0.1", channel: "dev" });
    expect(String(lines[0]?.windowsBuild)).toMatch(/^\d+(\.\d+)?$/);
    expect(typeof lines[0]?.dotnetRelease).toBe("number");
    expect(lines.map((l) => l.event)).toEqual(["started", "stdin_closed"]);
  }, 15_000);

  test("a killed tray exits nonzero", async () => {
    const tray = start();
    await readUntil(tray.stdout, "started");
    tray.kill();
    expect(await tray.exited).not.toBe(0);
  }, 15_000);
});
