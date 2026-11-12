import { describe, expect, test } from "vitest";
import type { StatusInfo } from "../control";
import { waitHealthy } from "./health";

type Answer = "refused" | "starting" | StatusInfo;

/** A clock that only moves when the health check sleeps, and a probe answering by the time since start. */
function run(answerAt: (sec: number) => Answer, version = "0.1.1") {
  let t = 1_000_000;
  const start = t;
  const probed: number[] = [];
  const result = waitHealthy({
    port: 49_200,
    version,
    probe: (port) => {
      expect(port).toBe(49_200);
      probed.push((t - start) / 1000);
      return Promise.resolve(answerAt((t - start) / 1000));
    },
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  });
  return { result, probed, elapsed: () => (t - start) / 1000 };
}

const up = (pid: number, version = "0.1.1"): StatusInfo => ({ pid, version, connection: "waiting" });

describe("waitHealthy", () => {
  test("passes once the same pid at the expected version still answers 2 min after it was first seen", async () => {
    const r = run((s) => (s < 10 ? "refused" : s < 20 ? "starting" : up(500)));
    expect(await r.result).toEqual({ ok: true, pid: 500 });
    expect(r.elapsed()).toBe(140);
    expect(r.probed.slice(0, 3)).toEqual([0, 2, 4]);
  });

  test("a tracker restarted under a new pid starts the 2 min over, and one that keeps restarting fails at 10 min", async () => {
    const r = run((s) => up(1000 + Math.floor(s / 90)));
    expect(await r.result).toEqual({ ok: false, last: up(1006) });
    expect(r.elapsed()).toBe(600);
  });

  test("a restart that settles passes 2 min after the last new pid", async () => {
    const r = run((s) => (s < 60 ? up(1) : up(2)));
    expect(await r.result).toEqual({ ok: true, pid: 2 });
    expect(r.elapsed()).toBe(180);
  });

  test("the old version answering never passes", async () => {
    const r = run(() => up(7, "0.1.0"));
    expect(await r.result).toEqual({ ok: false, last: up(7, "0.1.0") });
    expect(r.elapsed()).toBe(600);
  });

  test("an answer from another version clears the pid seen, even under the same pid", async () => {
    const r = run((s) => (s === 100 ? up(5, "0.1.0") : up(5)));
    expect(await r.result).toEqual({ ok: true, pid: 5 });
    expect(r.elapsed()).toBe(222);
  });

  test("a timeout between two answers from the same pid doesn't start the 2 min over", async () => {
    const r = run((s) => (s === 60 ? "starting" : up(5)));
    expect(await r.result).toEqual({ ok: true, pid: 5 });
    expect(r.elapsed()).toBe(120);
  });

  test("a tracker that answered once and then stopped answering fails, reporting the last reading", async () => {
    const r = run((s) => (s < 30 ? up(5) : "refused"));
    expect(await r.result).toEqual({ ok: false, last: "refused" });
    expect(r.elapsed()).toBe(600);
  });
});
