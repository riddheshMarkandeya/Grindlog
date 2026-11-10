import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { moveData, parseArgs, planCopy, probeInUse, resolveDir } from "./move-data";

let root: string;
let from: string;
let to: string;
let lines: string[];
const out = (line: string) => {
  lines.push(line);
};

/** Every file under `dir`, as forward-slash paths relative to it. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name).slice(dir.length + 1).replace(/\\/g, "/"))
    .sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grindlog-move-"));
  from = join(root, "Old");
  to = join(root, "New");
  lines = [];
  mkdirSync(join(from, "bin", "web"), { recursive: true });
  mkdirSync(join(from, "backups"), { recursive: true });
  const db = new Database(join(from, "tracker.db"));
  db.run("CREATE TABLE t (x INTEGER)");
  db.run("INSERT INTO t VALUES (1), (2)");
  db.close();
  writeFileSync(join(from, "backups", "tracker-1.db.bak"), "backup");
  writeFileSync(join(from, "tracker.log"), "line\n");
  writeFileSync(join(from, "tracker.log.1"), "older\n");
  writeFileSync(join(from, "supervisor.log"), "sup\n");
  writeFileSync(join(from, "settings.json"), "{}");
  writeFileSync(join(from, "bin", "grindlog.exe"), "exe");
  writeFileSync(join(from, "bin", "web", "index.html"), "<html>");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveDir", () => {
  test("a bare name is a folder under LOCALAPPDATA", () => {
    expect(resolveDir("GrindlogDev", { LOCALAPPDATA: String.raw`C:\L` })).toBe(join(String.raw`C:\L`, "GrindlogDev"));
  });

  test("a path is taken as given", () => {
    expect(resolveDir(String.raw`D:\data\x`, { LOCALAPPDATA: String.raw`C:\L` })).toBe(String.raw`D:\data\x`);
  });
});

describe("parseArgs", () => {
  test("two folders, and --copy anywhere", () => {
    expect(parseArgs(["a", "b"])).toEqual({ from: "a", to: "b", copy: false });
    expect(parseArgs(["--copy", "a", "b"])).toEqual({ from: "a", to: "b", copy: true });
  });

  test("anything else is a usage error", () => {
    for (const bad of [[], ["a"], ["a", "b", "c"], ["a", "b", "--move"]]) expect(parseArgs(bad), bad.join(" ")).toBeNull();
  });
});

describe("planCopy", () => {
  test("everything but bin, with the root's log files moved into logs", () => {
    const dests = planCopy(from, to).map((e) => e.dest.slice(to.length + 1).replace(/\\/g, "/"));
    expect(dests.sort()).toEqual(["backups/tracker-1.db.bak", "logs/supervisor.log", "logs/tracker.log", "logs/tracker.log.1", "settings.json", "tracker.db"]);
  });

  test("a log in the root and one already in logs with the same name is refused, not overwritten", () => {
    mkdirSync(join(from, "logs"));
    writeFileSync(join(from, "logs", "tracker.log"), "new");
    expect(() => planCopy(from, to)).toThrow(/tracker\.log/);
  });
});

describe("probeInUse", () => {
  test("a folder nothing holds is free, and is left where it was", async () => {
    expect(await probeInUse(from)).toBe("free");
    expect(existsSync(from)).toBe(true);
    expect(existsSync(`${from}.probe`)).toBe(false);
  });

  test("a refused first rename means in use", async () => {
    const rename = () => {
      throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    };
    expect(await probeInUse(from, { rename, sleep: () => Promise.resolve(), timeoutMs: 0 })).toBe("in_use");
  });

  test("a rename back that keeps failing names both paths", async () => {
    let calls = 0;
    const rename = () => {
      if (++calls > 1) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    };
    await expect(probeInUse(from, { rename, sleep: () => Promise.resolve(), timeoutMs: 0 })).rejects.toThrow(`${from}.probe`);
  });
});

describe("moveData", () => {
  test("move: copies, verifies, and keeps the source as the backup", async () => {
    expect(await moveData({ from, to, copy: false }, { out })).toBe(0);
    expect(tree(to)).toEqual(["backups/tracker-1.db.bak", "logs/supervisor.log", "logs/tracker.log", "logs/tracker.log.1", "settings.json", "tracker.db"]);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(join(`${to}.pre-move-backup`, "settings.json"), "utf8")).toBe("{}");
    const db = new Database(join(to, "tracker.db"), { readonly: true });
    expect(db.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    db.close();
    const text = lines.join("\n");
    expect(text).toContain("6 files");
    expect(text).toContain(`${to}.pre-move-backup`);
  });

  test("copy: leaves the source where it is", async () => {
    expect(await moveData({ from, to, copy: true }, { out })).toBe(0);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
    expect(existsSync(`${to}.pre-move-backup`)).toBe(false);
    expect(tree(to)).toContain("tracker.db");
  });

  test("a byte that changed in the copy fails verification, removes the copy and keeps the source", async () => {
    const tampering = (src: string, dest: string) => {
      copyFileSync(src, dest);
      if (dest.endsWith("settings.json")) writeFileSync(dest, "{ }");
    };
    expect(await moveData({ from, to, copy: false }, { out, copyFile: tampering })).toBe(1);
    expect(existsSync(to)).toBe(false);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
    expect(lines.join("\n")).toMatch(/settings\.json.*SHA-256/);
  });

  test("a database that fails its integrity check fails verification the same way", async () => {
    writeFileSync(join(from, "broken.db"), "not a database at all, just text that is long enough");
    expect(await moveData({ from, to, copy: false }, { out })).toBe(1);
    expect(existsSync(to)).toBe(false);
    expect(lines.join("\n")).toMatch(/broken\.db.*quick_check/);
  });

  test("a missing source is refused and creates nothing", async () => {
    expect(await moveData({ from: join(root, "Nope"), to, copy: false }, { out })).toBe(1);
    expect(existsSync(to)).toBe(false);
  });

  test("a destination with files in it is refused and left as it was", async () => {
    mkdirSync(to);
    writeFileSync(join(to, "keep.txt"), "x");
    expect(await moveData({ from, to, copy: false }, { out })).toBe(1);
    expect(tree(to)).toEqual(["keep.txt"]);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
  });

  test("an empty destination folder is fine", async () => {
    mkdirSync(to);
    expect(await moveData({ from, to, copy: true }, { out })).toBe(0);
  });

  test("a backup left from an earlier move is refused before anything is copied", async () => {
    mkdirSync(`${to}.pre-move-backup`);
    expect(await moveData({ from, to, copy: false }, { out })).toBe(1);
    expect(existsSync(to)).toBe(false);
  });

  test("a source with nothing but bin is refused, not put aside", async () => {
    const bare = join(root, "Bare");
    mkdirSync(join(bare, "bin"), { recursive: true });
    writeFileSync(join(bare, "bin", "grindlog.exe"), "exe");
    expect(await moveData({ from: bare, to, copy: false }, { out })).toBe(1);
    expect(existsSync(join(bare, "bin", "grindlog.exe"))).toBe(true);
    expect(existsSync(`${to}.pre-move-backup`)).toBe(false);
    expect(lines.join("\n")).toMatch(/nothing to move/);
  });

  test("a destination that is a file is refused with a message", async () => {
    writeFileSync(to, "x");
    expect(await moveData({ from, to, copy: false }, { out })).toBe(1);
    expect(lines.join("\n")).toMatch(/is a file/);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
  });

  test("a failed copy whose removal also fails says to delete it by hand, and keeps the source", async () => {
    const tampering = (src: string, dest: string) => {
      copyFileSync(src, dest);
      if (dest.endsWith("settings.json")) writeFileSync(dest, "{ }");
    };
    const remove = () => {
      throw Object.assign(new Error("EBUSY: held"), { code: "EBUSY" });
    };
    expect(await moveData({ from, to, copy: false }, { out, copyFile: tampering, remove })).toBe(1);
    expect(lines.join("\n")).toMatch(/could not be removed.*delete it by hand/);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
  });

  test("a failed final rename keeps both copies and says so", async () => {
    const rename = (a: string, b: string) => {
      // Only the final rename fails; the probe's pair is let through as no-ops.
      if (b.endsWith(".pre-move-backup")) throw Object.assign(new Error(`EPERM: ${a}`), { code: "EPERM" });
    };
    expect(await moveData({ from, to, copy: false }, { out, rename })).toBe(1);
    expect(existsSync(join(to, "settings.json"))).toBe(true);
    expect(existsSync(join(from, "settings.json"))).toBe(true);
    expect(lines.join("\n")).toMatch(/both/i);
  });
});

describe("the script", () => {
  test("a refused run never creates the destination, which the app's logger would if it were loaded", () => {
    const res = Bun.spawnSync([process.execPath, join(import.meta.dirname, "move-data.ts"), "NoSuchFolder", "GrindlogDev"], {
      // No data-dir override, so a wrongly loaded logger would write under root\GrindlogDev.
      env: { ...process.env, LOCALAPPDATA: root, GRINDLOG_DATA_DIR: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(res.exitCode).toBe(1);
    expect(res.stdout.toString() + res.stderr.toString()).toContain("NoSuchFolder");
    expect(existsSync(join(root, "GrindlogDev"))).toBe(false);
  });
});
