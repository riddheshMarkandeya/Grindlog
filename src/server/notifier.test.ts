import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNotifier } from "./notifier";
import { memoryLogger } from "./testing";

const first = { title: "Grindlog", body: "first" };
const second = { title: "Grindlog", body: "second" };
const ack = (id: number, instance = "run1") => ({ id, instance });

describe("createNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const logger = memoryLogger();
    const toast = vi.fn<(n: { title: string; body: string }) => Promise<void>>(() => Promise.resolve());
    const notifier = createNotifier({ logger, now: Date.now, toast, instance: "run1" });
    return { logger, toast, notifier };
  }

  test("with no tray polling, a notice goes straight to PowerShell", async () => {
    const { logger, toast, notifier } = setup();
    await notifier.notify(first);
    expect(toast).toHaveBeenCalledWith(first);
    expect(logger.events()).toContain("notice/powershell");
    expect(notifier.poll(null)).toEqual({ instance: "run1", notices: [] });
  });

  test("with a recent poll, it's queued for the tray and returned on every poll until acked", async () => {
    const { logger, toast, notifier } = setup();
    notifier.poll(null);
    await notifier.notify(first);
    expect(toast).not.toHaveBeenCalled();
    expect(logger.events()).toContain("notice/queued");
    expect(notifier.poll(null).notices).toEqual([{ id: 1, ...first }]);
    expect(notifier.poll(ack(0)).notices).toEqual([{ id: 1, ...first }]);
    expect(notifier.poll(ack(1)).notices).toEqual([]);
    expect(logger.events()).toContain("notice/acked");
  });

  test("ids increase, and an ack takes only the ids up to it", async () => {
    const { notifier } = setup();
    notifier.poll(null);
    await notifier.notify(first);
    await notifier.notify(second);
    expect(notifier.poll(ack(1)).notices).toEqual([{ id: 2, ...second }]);
  });

  test("an ack from an earlier tracker run acks nothing, since ids restart at 1 in every run", async () => {
    const { logger, notifier } = setup();
    notifier.poll(null);
    await notifier.notify(first);
    expect(notifier.poll(ack(3, "run0")).notices).toEqual([{ id: 1, ...first }]);
    expect(logger.events()).not.toContain("notice/acked");
  });

  test("a poll more than 10 s ago counts as no tray", async () => {
    const { toast, notifier } = setup();
    notifier.poll(null);
    vi.advanceTimersByTime(10_001);
    await notifier.notify(first);
    expect(toast).toHaveBeenCalledWith(first);
  });

  test("a notice the tray hasn't acked after 10 s goes to PowerShell once, and the tray never sees it again", async () => {
    const { logger, toast, notifier } = setup();
    notifier.poll(null);
    await notifier.notify(first);
    vi.advanceTimersByTime(9_999);
    expect(toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(first);
    expect(logger.events()).toContain("notice/fallback");
    expect(notifier.poll(null).notices).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  test("a notice acked at 9.9 s is not toasted when its 10 s timer fires", async () => {
    const { toast, notifier } = setup();
    notifier.poll(null);
    await notifier.notify(first);
    vi.advanceTimersByTime(9_900);
    notifier.poll(ack(1));
    vi.advanceTimersByTime(1_000);
    expect(toast).not.toHaveBeenCalled();
  });
});
