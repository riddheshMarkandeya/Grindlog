import { describe, expect, test } from "vitest";
import { compileArgs } from "./build-exe";

describe("compileArgs", () => {
  const base = { entry: String.raw`C:\repo\main.ts`, outfile: String.raw`C:\bin\grindlog.new.exe`, description: "Grindlog Dev", icon: String.raw`C:\repo\favicon.ico`, version: "1.2.3" };
  const args = compileArgs(base);
  const flag = (a: string[], name: string) => a[a.indexOf(name) + 1];

  test("a hidden-console compile of the entry to the outfile", () => {
    expect(args.slice(0, 2)).toEqual(["build", "--compile"]);
    expect(args).toContain("--windows-hide-console");
    expect(args).toContain(String.raw`C:\repo\main.ts`);
    expect(flag(args, "--outfile")).toBe(String.raw`C:\bin\grindlog.new.exe`);
  });

  test("sets what Task Manager and the file's properties show", () => {
    expect(flag(args, "--windows-description")).toBe("Grindlog Dev");
    // Task Manager can show either; a dev build must say so in both.
    expect(flag(args, "--windows-title")).toBe("Grindlog Dev");
    expect(flag(args, "--windows-publisher")).toBe("Grindlog");
    // Without it, Bun puts its own licensing URL in the file's copyright field.
    expect(flag(args, "--windows-copyright")).toBe("Copyright (c) 2026 Riddhesh Markandeya");
    expect(flag(args, "--windows-icon")).toBe(String.raw`C:\repo\favicon.ico`);
  });

  test("the title follows the description, not the channel of the script that builds it", () => {
    expect(flag(compileArgs({ ...base, description: "Grindlog" }), "--windows-title")).toBe("Grindlog");
  });

  test("the version gets the four parts the flag takes", () => {
    expect(flag(args, "--windows-version")).toBe("1.2.3.0");
  });

  test("a suffixed version keeps only its numeric part, which is all the flag takes", () => {
    expect(flag(compileArgs({ ...base, version: "1.2.3-rc.4" }), "--windows-version")).toBe("1.2.3.0");
  });

  test("no defines unless asked, so a dev build stays dev", () => {
    expect(args).not.toContain("--define");
  });

  test("each define is passed as a JSON string literal", () => {
    const a = compileArgs({ ...base, defines: { GRINDLOG_CHANNEL: "prod", GRINDLOG_VERSION: "1.2.3-rc.4" } });
    const defines = a.flatMap((x, i) => (a[i - 1] === "--define" ? [x] : []));
    expect(defines).toEqual(['GRINDLOG_CHANNEL="prod"', 'GRINDLOG_VERSION="1.2.3-rc.4"']);
  });
});
