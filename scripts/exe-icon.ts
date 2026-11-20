// Makes a compiled exe's icon the full set from its .ico. Bun 1.4.3's --windows-icon keeps its own
// one-entry icon group (IDI_MYICON, which declares 256 px but points at the .ico's 16 px frame) ahead of
// the full group it writes for the .ico, and Windows takes the first group, so Start, search and
// Explorer scale one 16 px image up. The fix points the first group's name entry at the full group's
// language directory: 4 bytes written in place, so nothing grows or moves. A Bun that gets it right
// shows up as "already right".
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { basename } from "node:path";
import { ICO_ENTRY_BYTES, ICO_HEADER_BYTES } from "./make-icons";
import { retryWhileLocked, StepFailed } from "./steps";

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const PE32_PLUS = 0x20b;
const RESOURCE_TABLE = 2;
/** The high bit of a resource directory entry: a string name, or an offset to a subdirectory. */
const HIGH_BIT = 0x80000000;
const PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";

class IconFormatError extends Error {}

export interface IcoFrame {
  size: number;
}

export interface IconGroup {
  /** The group's name, or `#<id>` for a numbered one. */
  name: string;
  /** The file offset of the name entry's OffsetToData field, which the fix overwrites. */
  entryOffset: number;
  /** Where the group's language directory sits, from the start of the resource directory. */
  subdir: number;
  entries: { size: number; iconId: number }[];
}

export interface IconResources {
  /** In directory order, which is the order Windows picks from. */
  groups: IconGroup[];
  /** Each RT_ICON's real width, from its PNG or bitmap header, by id. */
  iconWidths: Record<number, number>;
}

export type IconFix =
  | { kind: "ok"; first: string }
  | { kind: "repoint"; from: string; to: string; offset: number; value: number; reason: string }
  | { kind: "unfixable"; reason: string };

const bufferOf = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The frame sizes of an .ico, in the order `packIco` wrote them. */
export function parseIco(bytes: Uint8Array): IcoFrame[] {
  const b = bufferOf(bytes);
  if (b.length < ICO_HEADER_BYTES || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) throw new IconFormatError("not an .ico (bad header)");
  // One byte per entry, where 0 means 256.
  return Array.from({ length: b.readUInt16LE(4) }, (_, i) => ({ size: b.readUInt8(ICO_HEADER_BYTES + ICO_ENTRY_BYTES * i) || 256 }));
}

/** The icon groups and icons of a PE file's resource directory. */
export function readIconResources(pe: Uint8Array): IconResources {
  const b = bufferOf(pe);
  if (b.toString("latin1", 0, 2) !== "MZ") throw new IconFormatError("not an exe (no MZ header)");
  const header = b.readUInt32LE(0x3c);
  if (b.toString("latin1", header, header + 4) !== "PE\0\0") throw new IconFormatError("not an exe (no PE header)");
  const optional = header + 24;
  const dataDirectories = optional + (b.readUInt16LE(optional) === PE32_PLUS ? 112 : 96);
  const rootRva = b.readUInt32LE(dataDirectories + 8 * RESOURCE_TABLE);
  const sectionTable = optional + b.readUInt16LE(header + 20);
  const sections = Array.from({ length: b.readUInt16LE(header + 6) }, (_, i) => {
    const at = sectionTable + 40 * i;
    return { va: b.readUInt32LE(at + 12), size: Math.max(b.readUInt32LE(at + 8), b.readUInt32LE(at + 16)), raw: b.readUInt32LE(at + 20) };
  });
  // Found through the data directory rather than by the name .rsrc, which nothing guarantees.
  const section = sections.find((s) => rootRva >= s.va && rootRva < s.va + s.size);
  if (rootRva === 0 || section === undefined) throw new IconFormatError("the exe has no resource directory");
  const fileOffset = (rva: number) => {
    // Bun keeps all resource data in the resource section; anywhere else would read the wrong bytes.
    if (rva < section.va || rva >= section.va + section.size) throw new IconFormatError(`resource data at RVA ${String(rva)} is outside the resource section`);
    return rva - section.va + section.raw;
  };
  const root = fileOffset(rootRva);

  const entries = (dir: number) => {
    const at = root + dir;
    return Array.from({ length: b.readUInt16LE(at + 12) + b.readUInt16LE(at + 14) }, (_, i) => {
      const entry = at + 16 + 8 * i;
      const name = b.readUInt32LE(entry);
      const target = b.readUInt32LE(entry + 4);
      const nameAt = root + (name & ~HIGH_BIT);
      return {
        name: (name & HIGH_BIT) !== 0 ? b.toString("utf16le", nameAt + 2, nameAt + 2 + 2 * b.readUInt16LE(nameAt)) : `#${String(name)}`,
        id: name,
        dataField: entry + 4,
        target: target & ~HIGH_BIT,
        isDir: (target & HIGH_BIT) !== 0,
      };
    });
  };
  // A type's names, each with the data of its first language.
  const named = (type: number) => {
    const typeEntry = entries(0).find((e) => e.id === type);
    if (typeEntry === undefined) return [];
    if (!typeEntry.isDir) throw new IconFormatError(`resource type ${String(type)} has no name directory`);
    return entries(typeEntry.target).map((nameEntry) => {
      const lang = nameEntry.isDir ? entries(nameEntry.target)[0] : undefined;
      if (lang === undefined || lang.isDir) throw new IconFormatError(`resource ${nameEntry.name} of type ${String(type)} has no language entry`);
      const at = root + lang.target;
      const data = fileOffset(b.readUInt32LE(at));
      return { nameEntry, data: b.subarray(data, data + b.readUInt32LE(at + 4)) };
    });
  };

  const iconWidths: Record<number, number> = {};
  for (const { nameEntry, data } of named(RT_ICON)) {
    iconWidths[nameEntry.id] = data.toString("latin1", 0, 8) === PNG_SIGNATURE ? data.readUInt32BE(16) : data.readInt32LE(4);
  }
  const groups = named(RT_GROUP_ICON).map(({ nameEntry, data }) => ({
    name: nameEntry.name,
    entryOffset: nameEntry.dataField,
    subdir: nameEntry.target,
    entries: Array.from({ length: data.readUInt16LE(4) }, (_, i) => ({ size: data.readUInt8(6 + 14 * i) || 256, iconId: data.readUInt16LE(6 + 14 * i + 12) })),
  }));
  return { groups, iconWidths };
}

function describe({ name, entries }: IconGroup, widths: Record<number, number>): string {
  const sizes = entries.map(({ size, iconId }) => {
    const real = widths[iconId];
    if (real === undefined) return `declares ${String(size)}, no icon ${String(iconId)}`;
    return real === size ? String(size) : `declares ${String(size)}, really ${String(real)}`;
  });
  return `${name} (${String(entries.length)} ${entries.length === 1 ? "entry" : "entries"}: ${sizes.join(", ")})`;
}

const matches = ({ entries }: IconGroup, widths: Record<number, number>, frames: readonly { size: number }[]) =>
  entries.length === frames.length && entries.every(({ size, iconId }, i) => size === frames[i]?.size && widths[iconId] === size);

/** Whether the first icon group already is the .ico's frames, and if not, which later group to point it at. */
export function planIconFix({ groups, iconWidths }: IconResources, frames: readonly { size: number }[]): IconFix {
  const [first, ...rest] = groups;
  if (first === undefined) return { kind: "unfixable", reason: "the exe has no icon group" };
  if (matches(first, iconWidths, frames)) return { kind: "ok", first: describe(first, iconWidths) };
  const reason = `the first icon group, ${describe(first, iconWidths)}, doesn't match the .ico's ${frames.map((f) => String(f.size)).join(", ")}`;
  const target = rest.find((g) => matches(g, iconWidths, frames));
  if (target === undefined) return { kind: "unfixable", reason: `${reason}, and no other group does` };
  return { kind: "repoint", from: describe(first, iconWidths), to: describe(target, iconWidths), offset: first.entryOffset, value: (HIGH_BIT | target.subdir) >>> 0, reason };
}

/** Null when the first icon group is the .ico's frames, else a sentence saying what's wrong. */
export function iconIssue(resources: IconResources, frames: readonly { size: number }[]): string | null {
  const plan = planIconFix(resources, frames);
  return plan.kind === "ok" ? null : plan.reason;
}

/** Reads a file for parsing, retrying while antivirus holds it; StepFailed naming the file. */
async function parseFile<T>(file: string, parse: (bytes: Uint8Array) => T): Promise<T> {
  let bytes: Buffer;
  try {
    bytes = await retryWhileLocked(`Reading ${file}`, () => readFileSync(file));
  } catch (err) {
    throw new StepFailed(`Could not read ${file}: ${(err as Error).message}`);
  }
  try {
    return parse(bytes);
  } catch (err) {
    // A truncated or odd file reads past the end of the buffer, which Buffer reports as a RangeError.
    if (err instanceof IconFormatError || err instanceof RangeError) throw new StepFailed(`${file}: ${err.message}`);
    throw err;
  }
}

/** `iconIssue` for an exe on disk against the .ico it was built with. */
export async function exeIconIssue(exe: string, ico: string): Promise<string | null> {
  return iconIssue(await parseFile(exe, readIconResources), await parseFile(ico, parseIco));
}

/** Points the exe's first icon group at the .ico's frames, unless it already is them; returns what it found and did. */
export async function fixExeIcon(exe: string, ico: string): Promise<string> {
  const frames = await parseFile(ico, parseIco);
  const plan = planIconFix(await parseFile(exe, readIconResources), frames);
  if (plan.kind === "ok") return `already right: first group ${plan.first} matches ${basename(ico)}`;
  if (plan.kind === "unfixable") throw new StepFailed(`${exe}: ${plan.reason}.`);
  const value = Buffer.alloc(4);
  value.writeUInt32LE(plan.value);
  try {
    const fd = await retryWhileLocked(`Opening ${exe}`, () => openSync(exe, "r+"));
    try {
      writeSync(fd, value, 0, value.length, plan.offset);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    throw new StepFailed(`Could not write ${exe}'s icon fix: ${(err as Error).message}`);
  }
  const issue = iconIssue(await parseFile(exe, readIconResources), frames);
  if (issue !== null) throw new StepFailed(`${exe}: after repointing its first icon group, ${issue}.`);
  return `first group ${plan.from} → repointed to ${plan.to}`;
}
