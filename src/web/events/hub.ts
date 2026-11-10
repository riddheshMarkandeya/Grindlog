// One /api/events stream fanned out to every tab. It runs in the SharedWorker (or in the page when
// SharedWorker is missing), so the tabs together hold one of the browser's 6 connections per host.
import { z } from "zod";
import { sseEvents, type SseEvents } from "../../shared/schemas/responses";
import type { Link } from "../logic/status";

export type HubMessage =
  | { type: "link"; link: Link }
  /** The tracker's release, read from each status before, and regardless of, its strict parse. */
  | { type: "version"; version: string | null }
  | { [K in keyof SseEvents]: { type: K; data: SseEvents[K] } }[keyof SseEvents];

export interface HubPort {
  postMessage(message: HubMessage): void;
}

/** The part of EventSource the hub uses. */
export interface HubSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

// EventSource.readyState values, named here because the hub also runs where EventSource isn't typed.
export const SOURCE_CONNECTING = 0;
export const SOURCE_OPEN = 1;
export const SOURCE_CLOSED = 2;

export interface HubOptions {
  openSource: () => HubSource;
  setTimer: (fn: () => void, ms: number) => void;
  warn: (message: string, detail?: unknown) => void;
}

const BACKOFF_FIRST_MS = 1000;
const BACKOFF_MAX_MS = 10_000;
const EVENT_NAMES = Object.keys(sseEvents) as (keyof SseEvents)[];
// Lenient on purpose: a newer tracker's status can fail this build's strict schema (a new enum
// value, say), and this tab must still learn the version to reload into the build that reads it.
const versionOnly = z.object({ version: z.string().nullable() });

export function createHub({ openSource, setTimer, warn }: HubOptions): { connect(port: HubPort): void } {
  const ports: HubPort[] = [];
  let source: HubSource | undefined;
  let link: Link = "connecting";
  let lastStatus: SseEvents["status"] | undefined;
  let lastVersion: { version: string | null } | undefined;
  let backoffMs = BACKOFF_FIRST_MS;

  const broadcast = (message: HubMessage) => {
    for (const port of ports) port.postMessage(message);
  };

  const setLink = (next: Link) => {
    if (next === link) return;
    link = next;
    broadcast({ type: "link", link });
  };

  const open = () => {
    const current = openSource();
    source = current;
    // A replaced source can still fire queued events; only the current one speaks.
    const live = () => source === current;
    current.addEventListener("open", () => {
      if (!live()) return;
      backoffMs = BACKOFF_FIRST_MS;
      setLink("open");
    });
    current.addEventListener("error", () => {
      if (!live()) return;
      setLink("down");
      // EventSource retries a dropped connection itself, but gives up for good after an HTTP
      // error status (the tracker's 503 while starting, or a dev proxy 5xx while it is down).
      if (current.readyState !== SOURCE_CLOSED) return;
      current.close();
      warn("[grindlog] events/reopen", { inMs: backoffMs });
      setTimer(open, backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    });
    for (const name of EVENT_NAMES) {
      current.addEventListener(name, (event) => {
        if (!live()) return;
        if (name === "status") {
          const version = readVersion(event.data);
          if (version) {
            lastVersion = version;
            broadcast({ type: "version", ...version });
          }
        }
        const message = parse(name, event.data, warn);
        if (!message) return;
        if (message.type === "status") lastStatus = message.data;
        broadcast(message);
      });
    }
  };

  return {
    connect(port) {
      ports.push(port);
      port.postMessage({ type: "link", link });
      if (lastVersion) port.postMessage({ type: "version", ...lastVersion });
      if (lastStatus) port.postMessage({ type: "status", data: lastStatus });
      if (!source) open();
    },
  };
}

/** The status's version, or undefined when it has none to read; parse() warns about the payload. */
function readVersion(data: unknown): { version: string | null } | undefined {
  try {
    const parsed = versionOnly.safeParse(JSON.parse(String(data)));
    return parsed.success ? { version: parsed.data.version } : undefined;
  } catch {
    return undefined;
  }
}

function parse(name: keyof SseEvents, data: unknown, warn: HubOptions["warn"]): HubMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(String(data));
  } catch {
    warn("[grindlog] events/bad_json", { name });
    return undefined;
  }
  const parsed = sseEvents[name].safeParse(json);
  if (!parsed.success) {
    warn("[grindlog] events/bad_payload", { name, issues: parsed.error.issues.map((i) => i.path.join(".")) });
    return undefined;
  }
  return { type: name, data: parsed.data } as HubMessage;
}
