// Live: builds the real tray exe and checks what only a real process can show: the stdin-close half
// of the quit protocol, and the poll loop against a fake /api/tray. Skipped, with the reason logged,
// where there is no csc.exe. The balloon case pops a real notification, so it runs only with
// GRINDLOG_LIVE_BALLOON=1.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { buildTray, findCsc } from "../../scripts/build-tray";
import { TRAY_HEADER } from "../shared/constants";
import type { TrayResponse } from "../shared/schemas/responses";

const csc = findCsc();
if (csc === null) console.log("tray.test: skipped, no csc.exe from .NET Framework 4.8");

type Line = Record<string, unknown>;

/** Collects the tray's stdout lines as they arrive. */
function collect(stdout: ReadableStream<Uint8Array>) {
  const lines: Line[] = [];
  const done = (async () => {
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, nl)) as Line);
        buf = buf.slice(nl + 1);
      }
    }
  })();
  return {
    lines,
    done,
    /** Resolves with the first line matching, failing after `ms`. */
    async waitFor(match: Partial<Line>, ms = 8000): Promise<Line> {
      const deadline = Date.now() + ms;
      const hit = () => lines.find((l) => Object.entries(match).every(([k, v]) => l[k] === v));
      for (let found = hit(); Date.now() < deadline; found = hit()) {
        if (found) return found;
        await Bun.sleep(50);
      }
      throw new Error(`no ${JSON.stringify(match)} within ${String(ms)} ms; got ${JSON.stringify(lines)}`);
    },
  };
}

const view = (over: Partial<TrayResponse> = {}): TrayResponse => ({ icon: "active", status: "Connected to Rocket League", lines: [], setupUrl: null, instance: "run1", notices: [], ...over });

describe.skipIf(csc === null)("the tray exe", () => {
  let dir: string;
  let exe: string;
  const running: Bun.Subprocess<"pipe", "pipe", "pipe">[] = [];
  const servers: Server<undefined>[] = [];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-tray-test-"));
    exe = join(dir, "grindlog-test-tray.exe");
    buildTray({ out: exe, channel: "dev", version: "0.0.1" });
  }, 60_000);
  afterEach(async () => {
    for (const tray of running.splice(0)) {
      await tray.stdin.end();
      await Promise.race([
        tray.exited,
        Bun.sleep(3000).then(() => {
          tray.kill();
        }),
      ]);
    }
    for (const server of servers.splice(0)) await server.stop(true);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  const start = (port = 1) => {
    const tray = Bun.spawn([exe, "--port", String(port), "--name", "Grindlog Test", "--logs", dir, "--version", "0.0.1", "--channel", "dev"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    running.push(tray);
    return tray;
  };

  /** A fake tracker: `answer` picks each poll's response; every request is kept. */
  function fake(answer: (n: number) => Response, port = 0) {
    const requests: { url: string; tray: string | null }[] = [];
    const server = Bun.serve({
      port,
      fetch(req) {
        requests.push({ url: req.url, tray: req.headers.get(TRAY_HEADER) });
        return answer(requests.length);
      },
    });
    servers.push(server);
    return { server, requests };
  }

  test("logs started, then exits 3 with stdin_closed once stdin closes", async () => {
    const tray = start();
    running.splice(running.indexOf(tray), 1);
    const out = collect(tray.stdout);
    // Give it time to show the icon, so the close lands on a running message loop.
    await Bun.sleep(1000);
    await tray.stdin.end();
    const code = await Promise.race([tray.exited, Bun.sleep(5000).then(() => "timeout" as const)]);
    if (code === "timeout") tray.kill();
    expect(code).toBe(3);
    await out.done;
    expect(out.lines[0]).toMatchObject({ event: "started", pid: tray.pid, version: "0.0.1", channel: "dev" });
    expect(String(out.lines[0]?.windowsBuild)).toMatch(/^\d+(\.\d+)?$/);
    expect(typeof out.lines[0]?.dotnetRelease).toBe("number");
    // Port 1 refuses (a poll_failed, if it fails inside the second), but no red inside the 15 s startup grace.
    expect(out.lines.map((l) => l.event).filter((e) => e !== "poll_failed")).toEqual(["started", "view", "stdin_closed"]);
    expect(out.lines[1]).toMatchObject({ icon: "ready", status: "Starting…" });
  }, 15_000);

  test("a killed tray exits nonzero", async () => {
    const tray = start();
    await collect(tray.stdout).waitFor({ event: "started" });
    tray.kill();
    expect(await tray.exited).not.toBe(0);
  }, 15_000);

  test("shows Starting… through a 503, then the view, sending the tray header, then an ack naming the run", async () => {
    const { server, requests } = fake((n) => (n === 1 ? Response.json({ error: "starting" }, { status: 503 }) : Response.json(view())));
    const out = collect(start(server.port).stdout);
    await out.waitFor({ event: "view", icon: "active", status: "Connected to Rocket League" });
    expect(out.lines.filter((l) => l.event === "view").map((l) => l.status)).toEqual(["Starting…", "Connected to Rocket League"]);
    expect(out.lines.map((l) => l.event)).not.toContain("unreachable");
    await out.waitFor({ event: "view", icon: "active" });
    while (requests.length < 3) await Bun.sleep(50);
    const [first, , third] = requests.map((r) => ({ ...r, url: new URL(r.url) }));
    expect(first?.tray).toBe("1");
    expect([first?.url.pathname, first?.url.search]).toEqual(["/api/tray", ""]);
    expect(Object.fromEntries(third?.url.searchParams ?? [])).toEqual({ ack: "0", instance: "run1" });
  }, 15_000);

  test("an HTTP error other than 503 is a bad answer, not red, and polls stay 2 s apart", async () => {
    const { server, requests } = fake((n) => (n === 1 ? Response.json(view()) : new Response("oops", { status: 500 })));
    const out = collect(start(server.port).stdout);
    await out.waitFor({ event: "view_bad", error: "http 500" });
    const at = requests.length;
    await Bun.sleep(4500);
    expect(requests.length - at).toBeLessThanOrEqual(3);
    expect(out.lines.map((l) => l.event)).not.toContain("unreachable");
  }, 15_000);

  test("goes red within ~5 s of the tracker stopping, and back when it returns", async () => {
    const first = fake(() => Response.json(view()));
    const port = first.server.port;
    const out = collect(start(port).stdout);
    await out.waitFor({ event: "view", icon: "active" });
    await first.server.stop(true);
    const stoppedAt = Date.now();
    await out.waitFor({ event: "unreachable" }, 8000);
    expect(Date.now() - stoppedAt).toBeLessThan(6500);
    expect(out.lines.find((l) => l.event === "view" && l.icon === "stopped")).toMatchObject({ status: "Not responding" });
    fake(() => Response.json(view({ icon: "ready", status: "Ready, waiting for Rocket League" })), port);
    await out.waitFor({ event: "reachable" });
    await out.waitFor({ event: "view", icon: "ready" });
  }, 25_000);

  test("bad JSON keeps the last view and logs view_bad once", async () => {
    const { server } = fake((n) => (n === 1 ? Response.json(view()) : new Response("{not json")));
    const out = collect(start(server.port).stdout);
    await out.waitFor({ event: "view_bad" });
    await Bun.sleep(4500);
    expect(out.lines.filter((l) => l.event === "view_bad")).toHaveLength(1);
    expect(out.lines.filter((l) => l.event === "view").map((l) => l.icon)).toEqual(["ready", "active"]);
  }, 15_000);

  test.skipIf(process.env.GRINDLOG_LIVE_BALLOON !== "1")("shows a notice as a balloon and acks it on the next poll", async () => {
    const notice = { id: 7, title: "Grindlog Test", body: "A live balloon from tray.test.ts" };
    const { server, requests } = fake(() => Response.json(view({ notices: [notice] })));
    const out = collect(start(server.port).stdout);
    await out.waitFor({ event: "balloon_shown", id: 7 });
    await Bun.sleep(2500);
    expect(requests.map((r) => new URL(r.url).search)).toContain("?ack=7&instance=run1");
    expect(out.lines.filter((l) => l.event === "balloon_shown")).toHaveLength(1);
  }, 15_000);
});
