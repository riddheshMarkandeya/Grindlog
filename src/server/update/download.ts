import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { renameRetry } from "../fs-retry";
import type { Logger } from "../log";
import { isHttpUrl, USER_AGENT, type Asset } from "./feed";

export interface DownloadOptions {
  /** Counted on the bytes actually streamed, not on what the server or feed claims. */
  maxBytes: number;
  logger: Logger;
  /** The body must begin with this (a .minisig's first line), or the download failed. */
  mustStartWith?: string;
  idleMs?: number;
  totalMs?: number;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** The part of a body reader used here; Bun's own reader type adds methods a plain stream lacks. */
interface ChunkReader {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
  cancel(): Promise<void>;
}

const IDLE_MS = 60_000;
const TOTAL_MS = 15 * 60_000;

/**
 * Fetches (or, from a folder feed, copies) `asset` to `dest` through `dest.partial`, so a cut-short
 * download never sits under the real name. Throws on any failure, after removing the partial.
 */
export async function download(asset: Asset, dest: string, o: DownloadOptions): Promise<void> {
  if (asset.size > o.maxBytes) throw new Error(`${asset.name} is too large: ${String(asset.size)} bytes, maxBytes ${String(o.maxBytes)}`);
  const partial = `${dest}.partial`;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    const written = isHttpUrl(asset.url) ? await fetchTo(asset.url, partial, o) : copyTo(asset.url, partial, o.maxBytes);
    if (written !== asset.size) throw new Error(`${asset.name} size ${String(written)} isn't the expected ${String(asset.size)}`);
    if (o.mustStartWith !== undefined && !startsWith(partial, o.mustStartWith)) throw new Error(`${asset.name} doesn't start with "${o.mustStartWith}"`);
    renameRetry(partial, dest, { logger: o.logger });
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
}

function copyTo(path: string, partial: string, maxBytes: number): number {
  const { size } = statSync(path);
  if (size > maxBytes) throw new Error(`${path} is too large: ${String(size)} bytes, maxBytes ${String(maxBytes)}`);
  copyFileSync(path, partial);
  return statSync(partial).size;
}

async function fetchTo(url: string, partial: string, { maxBytes, idleMs = IDLE_MS, totalMs = TOTAL_MS, fetch = globalThis.fetch }: DownloadOptions): Promise<number> {
  const abort = new AbortController();
  const total = setTimeout(() => { abort.abort(new Error(`download timed out after ${String(totalMs)} ms`)); }, totalMs);
  const fd = openSync(partial, "w");
  try {
    // The idle bound covers waiting for the headers too, not only the gaps in the body.
    const noHeaders = setTimeout(() => { abort.abort(new Error(`no response within ${String(idleMs)} ms`)); }, idleMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: abort.signal });
    } finally {
      clearTimeout(noHeaders);
    }
    if (!res.ok || res.body === null) throw new Error(`HTTP ${String(res.status)} for ${url}`);
    const reader = res.body.getReader() as ChunkReader;
    let written = 0;
    for (;;) {
      const chunk = await readWithin(reader, idleMs, abort.signal);
      if (chunk.done) return written;
      written += chunk.value.byteLength;
      if (written > maxBytes) throw new Error(`download too large: over maxBytes ${String(maxBytes)}`);
      writeSync(fd, chunk.value);
    }
  } finally {
    clearTimeout(total);
    closeSync(fd);
  }
}

/** The next chunk, or a throw if none arrives within `idleMs` or the whole download is aborted. */
async function readWithin(reader: ChunkReader, idleMs: number, signal: AbortSignal): ReturnType<ChunkReader["read"]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = (): void => undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error(`download idle for ${String(idleMs)} ms`)); }, idleMs);
    onAbort = () => { reject(signal.reason as Error); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } catch (err) {
    void reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function startsWith(path: string, prefix: string): boolean {
  const want = Buffer.from(prefix, "utf8");
  const got = Buffer.alloc(want.length);
  const fd = openSync(path, "r");
  try {
    return readSync(fd, got, 0, want.length, 0) === want.length && got.equals(want);
  } finally {
    closeSync(fd);
  }
}
