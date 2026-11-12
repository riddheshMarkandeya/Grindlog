// Routes the app's toasts: through the tray while it's polling, so they show under the app's own name and
// a click opens the dashboard, else through PowerShell's app ID, which is always registered.
import { randomBytes } from "node:crypto";
import type { TrayAck } from "../shared/schemas/params";
import type { TrayNotice } from "../shared/schemas/responses";
import type { Logger } from "./log";
import { runPowerShell } from "./powershell";

export interface Toast {
  title: string;
  body: string;
}

const TOAST_TIMEOUT_MS = 10_000;
// PowerShell's own AppUserModelID: a toast needs a registered app, and this one always is.
const POWERSHELL_APP_ID = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A toast shown straight through PowerShell, which (unlike the tray's) can open a web page when clicked. */
export interface PowerShellToast extends Toast {
  /** Opened on click. Callers also put it in the body: whether the click opens it varies by Windows build. */
  url?: string;
}

/** The PowerShell that shows `toast`. Every string goes in single-quoted, so nothing in it is evaluated. */
export function toastScript({ title, body, url }: PowerShellToast): string {
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$x = $t.GetElementsByTagName('text')",
    `$x.Item(0).AppendChild($t.CreateTextNode(${psQuote(title)})) > $null`,
    `$x.Item(1).AppendChild($t.CreateTextNode(${psQuote(body)})) > $null`,
    ...(url === undefined
      ? []
      : [`$t.DocumentElement.SetAttribute('activationType', 'protocol')`, `$t.DocumentElement.SetAttribute('launch', ${psQuote(url)})`]),
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(POWERSHELL_APP_ID)}).Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
  ].join("\n");
}

/** Shows a Windows toast through PowerShell. Best-effort: never throws, logs toast/shown or toast/failed. */
export async function showToast(logger: Logger, toast: PowerShellToast): Promise<void> {
  const { title, body, url } = toast;
  const script = toastScript(toast);
  try {
    const { code, stderr, timedOut } = await runPowerShell(script, TOAST_TIMEOUT_MS);
    if (code === 0) logger.info("toast", "shown", { title, body, url });
    else logger.warn("toast", "failed", { code, timedOut, stderr: stderr.slice(0, 500) });
  } catch (err) {
    // Broad on purpose: a toast is a nicety, and whatever stops PowerShell from starting must not
    // reach the recorder.
    logger.warn("toast", "failed", { err });
  }
}

export interface NotifierOptions {
  logger: Logger;
  now?: () => number;
  toast?: (toast: Toast) => Promise<void>;
  /** How long a queued notice waits for the tray's ack before PowerShell shows it instead. */
  fallbackMs?: number;
  /** A tray that polled this recently is taken to be running. */
  recentMs?: number;
  /** Names this tracker run; random by default. */
  instance?: string;
}

export interface Notifier {
  notify(toast: Toast): Promise<void>;
  /**
   * The tray's poll: acks notices up to `ack` and returns the rest, oldest first, with this run's
   * instance. Ids restart at 1 in every run while the tray outlives a tracker restart, so an ack
   * naming another instance acks nothing.
   */
  poll(ack: TrayAck | null): { instance: string; notices: TrayNotice[] };
}

export function createNotifier(opts: NotifierOptions): Notifier {
  const { logger, now = Date.now, fallbackMs = 10_000, recentMs = 10_000, instance = randomBytes(4).toString("hex") } = opts;
  const toast = opts.toast ?? ((t: Toast) => showToast(logger, t));
  let lastPoll: number | null = null;
  let nextId = 1;
  let queue: TrayNotice[] = [];

  // Acked rather than drained on read, so a response the tray never got (a timeout, bad JSON, a crash)
  // doesn't lose the notice: unacked, it falls back to PowerShell.
  function fallBack(id: number): void {
    const i = queue.findIndex((n) => n.id === id);
    const notice = queue[i];
    if (!notice) return;
    queue.splice(i, 1);
    logger.warn("notice", "fallback", { id, title: notice.title });
    void toast({ title: notice.title, body: notice.body });
  }

  return {
    async notify(t) {
      if (lastPoll !== null && now() - lastPoll <= recentMs) {
        const id = nextId++;
        queue.push({ id, ...t });
        logger.info("notice", "queued", { id, title: t.title });
        setTimeout(() => {
          fallBack(id);
        }, fallbackMs);
        return;
      }
      logger.info("notice", "powershell", { title: t.title, lastPollAgoMs: lastPoll === null ? null : now() - lastPoll });
      await toast(t);
    },
    poll(ack) {
      lastPoll = now();
      if (ack !== null && ack.instance === instance) {
        const acked = queue.filter((n) => n.id <= ack.id);
        if (acked.length > 0) {
          queue = queue.filter((n) => n.id > ack.id);
          logger.info("notice", "acked", { ids: acked.map((n) => n.id) });
        }
      }
      return { instance, notices: [...queue] };
    },
  };
}
