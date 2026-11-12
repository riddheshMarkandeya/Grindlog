// Fixes the game's Stats API settings in the Documents ini, for the dashboard's setup card.
import { readFileSync, writeFileSync } from "node:fs";
import { SUGGESTED_RATE } from "../shared/constants";
import type { StatsSetupError } from "../shared/schemas/responses";
import type { Logger } from "./log";
import { classifyIniLine, decodeIni, encodeIni, INI_KEY_NAMES, INI_NUMBER, isNodeError, parseStatsIni, SECTION_HEADER, userIniPath, type ConfigCheck } from "./stats-config";

/** The settings the fix may change: the rest of the file is the user's. */
export type FixKey = "packetSendRate" | "webPort";
export type FixWant = Partial<Record<FixKey, number>>;

interface Line {
  content: string;
  ending: string;
}

function splitLines(text: string): Line[] {
  if (text === "") return [];
  const parts = text.split(/(\r?\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push({ content: parts[i] ?? "", ending: parts[i + 1] ?? "" });
  // A trailing newline leaves an empty piece after it, which isn't a line.
  const last = lines.at(-1);
  if (lines.length > 1 && last?.content === "" && last.ending === "") lines.pop();
  return lines;
}

/**
 * Sets each wanted key in the exporter section, changing only the value after `=` (every duplicate,
 * since the last one wins). A wanted key the file lacks is inserted after the section's last
 * setting, or with the section appended when there's none. Everything else stays byte-identical.
 */
export function fixStatsIni(text: string, want: FixWant): { text: string; changed: FixKey[]; added: FixKey[] } {
  const keys = (Object.keys(want) as FixKey[]).filter((k) => want[k] !== undefined);
  if (keys.length === 0) return { text, changed: [], added: [] };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(text);
  const changed = new Set<FixKey>();
  const seen = new Set<FixKey>();
  let inSection = false;
  /** Where a missing key goes: after the last setting of the last exporter section, else its header. */
  let insertAfter = -1;
  lines.forEach((line, i) => {
    const c = classifyIniLine(line.content);
    if (c.kind === "section") {
      inSection = c.exporter;
      if (inSection) insertAfter = i;
      return;
    }
    if (!inSection) return;
    if (c.kind === "key" || line.content.includes("=")) insertAfter = i;
    if (c.kind !== "key" || !keys.includes(c.key as FixKey)) return;
    const key = c.key as FixKey;
    const value = want[key];
    seen.add(key);
    if (value === undefined || (INI_NUMBER.test(c.value) && Number(c.value) === value)) return;
    line.content = line.content.slice(0, c.valueStart) + String(value) + line.content.slice(c.valueEnd);
    changed.add(key);
  });

  const added = keys.filter((k) => !seen.has(k));
  const newLines = added.map((k) => `${INI_KEY_NAMES[k]}=${String(want[k])}`);
  if (added.length > 0) {
    let at: number;
    if (insertAfter < 0) {
      const last = lines.at(-1);
      if (last) {
        if (last.ending === "") last.ending = eol;
        if (last.content.trim() !== "") lines.push({ content: "", ending: eol });
      }
      newLines.unshift(SECTION_HEADER);
      at = lines.length - 1;
    } else at = insertAfter;
    const before = lines[at];
    // Inserted after the file's unterminated last line: the new last line stays unterminated.
    const unterminated = before?.ending === "";
    if (before && unterminated) before.ending = eol;
    const inserted = newLines.map((content, j) => ({ content, ending: unterminated && j === newLines.length - 1 ? "" : eol }));
    lines.splice(at + 1, 0, ...inserted);
  }
  return { text: lines.map((l) => l.content + l.ending).join(""), changed: keys.filter((k) => changed.has(k)), added };
}

export type ApplyResult = { ok: true; changed: FixKey[]; added: FixKey[] } | { ok: false; error: "no_file" | "write_failed" };

/**
 * Fixes the Documents ini in place, keeping its encoding and BOM. A missing file isn't created: the
 * game writes it on its first run, with settings this can't guess. Writing in place keeps the file's
 * identity; a torn write is a file the game regenerates.
 */
export function applyStatsFix({ iniPath, want, logger }: { iniPath: string; want: FixWant; logger: Logger }): ApplyResult {
  let decoded: ReturnType<typeof decodeIni>;
  try {
    decoded = decodeIni(readFileSync(iniPath));
  } catch (err) {
    if (isNodeError(err, "ENOENT")) {
      logger.info("game", "stats_setup_no_file", { path: iniPath });
      return { ok: false, error: "no_file" };
    }
    // Any fs failure (EPERM, EACCES, EBUSY, a OneDrive placeholder that won't download) gets the guide; anything else is a bug.
    if (!isNodeError(err)) throw err;
    // The card treats it as a failed write (the guide either way); the log keeps which step failed.
    logger.warn("game", "stats_setup_read_failed", { path: iniPath, err });
    return { ok: false, error: "write_failed" };
  }
  const fixed = fixStatsIni(decoded.text, want);
  const { changed, added } = fixed;
  if (changed.length === 0 && added.length === 0) {
    logger.info("game", "stats_setup_already_right", { path: iniPath });
    return { ok: true, changed, added };
  }
  try {
    writeFileSync(iniPath, encodeIni(fixed.text, decoded.encoding));
  } catch (err) {
    if (!isNodeError(err)) throw err;
    logger.warn("game", "stats_setup_write_failed", { path: iniPath, err });
    return { ok: false, error: "write_failed" };
  }
  logger.info("game", "stats_setup_fixed", { path: iniPath, changed, added, before: parseStatsIni(decoded.text), after: parseStatsIni(fixed.text) });
  if (added.length > 0) logger.warn("game", "stats_setup_key_added", { path: iniPath, added });
  return { ok: true, changed, added };
}

/** The fix's own check, kept under the browser's 10 s request timeout so a slow check answers check_failed rather than a timeout the card can't tell from a failed write. */
export const SETUP_CHECK_MS = 7_000;

/** The API's refusal codes, so the server and the card share one list. */
export type FixError = StatsSetupError;
export type FixResult = { ok: true; changed: FixKey[]; added: FixKey[] } | { ok: false; error: FixError };

/**
 * The setup card's fix: decides from a fresh check of the merged settings, so only keys the game
 * really reads wrong are touched, and a custom WebPort moves only with consent (another app may be
 * using it). After a write the status catches up through a background recheck; awaiting it as well
 * could outlast the browser's timeout.
 */
export async function runStatsFix(opts: {
  recheck: () => Promise<ConfigCheck | null | "timeout">;
  apply: (iniPath: string, want: FixWant) => ApplyResult;
  expectedWebPort: number;
  portConsent: boolean;
  logger: Logger;
}): Promise<FixResult> {
  const { recheck, apply, expectedWebPort, portConsent, logger } = opts;
  const refuse = (error: FixError, fields: Record<string, unknown> = {}): FixResult => {
    logger.info("game", "stats_setup_refused", { error, ...fields });
    return { ok: false, error };
  };
  const check = await recheck();
  if (check === null || check === "timeout") return refuse("check_failed", { check });
  const { problems } = check;
  const iniPath = userIniPath(check);
  if (problems.includes("no_ini") || problems.includes("user_missing") || iniPath === null) return refuse("no_file", { problems });
  if (problems.includes("web_port_mismatch") && !portConsent) return refuse("port_needs_consent", { webPort: check.effective.webPort });
  const want: FixWant = {};
  if (problems.includes("send_rate_off")) want.packetSendRate = SUGGESTED_RATE;
  if (problems.includes("web_port_off") || problems.includes("web_port_mismatch")) want.webPort = expectedWebPort;
  if (Object.keys(want).length === 0) {
    logger.info("game", "stats_setup_nothing_to_fix", { path: check.path });
    return { ok: true, changed: [], added: [] };
  }
  const result = apply(iniPath, want);
  if (result.ok && (result.changed.length > 0 || result.added.length > 0)) void recheck();
  return result;
}
