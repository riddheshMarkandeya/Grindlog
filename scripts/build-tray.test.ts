import { describe, expect, test } from "vitest";
import { assemblyInfo, exeIcon, findCsc, trayCompileArgs, trayIconPaths } from "./build-tray";

describe("exeIcon", () => {
  test("dev exes take the teal icon, prod's the orange favicon", () => {
    expect(exeIcon("dev")).toMatch(/assets[\\/]favicon-dev\.ico$/);
    expect(exeIcon("prod")).toMatch(/public[\\/]favicon\.ico$/);
  });
});

describe("trayIconPaths", () => {
  test("picks the channel's set: dev gets the tinted icons", () => {
    const icons = trayIconPaths("dev", String.raw`C:\repo\icons`);
    expect(icons.ready).toBe(String.raw`C:\repo\icons\dev-ready.ico`);
    expect(icons.stopped).toBe(String.raw`C:\repo\icons\dev-stopped.ico`);
    expect(trayIconPaths("prod", String.raw`C:\repo\icons`).attention).toBe(String.raw`C:\repo\icons\prod-attention.ico`);
  });
});

describe("trayCompileArgs", () => {
  const args = trayCompileArgs({
    out: String.raw`C:\bin\grindlog-dev-tray.new.exe`,
    icon: String.raw`C:\repo\favicon.ico`,
    trayIcons: {
      ready: String.raw`C:\repo\icons\dev-ready.ico`,
      active: String.raw`C:\repo\icons\dev-active.ico`,
      attention: String.raw`C:\repo\icons\dev-attention.ico`,
      stopped: String.raw`C:\repo\icons\dev-stopped.ico`,
    },
    manifest: String.raw`C:\repo\src\tray\tray.manifest`,
    sources: [String.raw`C:\repo\src\tray\Tray.cs`, String.raw`C:\tmp\AssemblyInfo.cs`],
  });

  test("an optimised, DPI-aware windowed exe: the favicon as file icon and the four state icons as resources", () => {
    expect(args).toEqual([
      "/nologo",
      "/target:winexe",
      "/optimize+",
      String.raw`/win32icon:C:\repo\favicon.ico`,
      String.raw`/win32manifest:C:\repo\src\tray\tray.manifest`,
      String.raw`/resource:C:\repo\icons\dev-ready.ico,Grindlog.tray.ready.ico`,
      String.raw`/resource:C:\repo\icons\dev-active.ico,Grindlog.tray.active.ico`,
      String.raw`/resource:C:\repo\icons\dev-attention.ico,Grindlog.tray.attention.ico`,
      String.raw`/resource:C:\repo\icons\dev-stopped.ico,Grindlog.tray.stopped.ico`,
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.Web.Extensions.dll",
      String.raw`/out:C:\bin\grindlog-dev-tray.new.exe`,
      String.raw`C:\repo\src\tray\Tray.cs`,
      String.raw`C:\tmp\AssemblyInfo.cs`,
    ]);
  });
});

describe("assemblyInfo", () => {
  test("sets the title Task Manager shows and a four-part numeric version", () => {
    const cs = assemblyInfo({ title: "Grindlog Dev", version: "1.2.3" });
    expect(cs).toContain('[assembly: AssemblyTitle("Grindlog Dev")]');
    expect(cs).toContain('[assembly: AssemblyProduct("Grindlog Dev")]');
    expect(cs).toContain('[assembly: AssemblyVersion("1.2.3.0")]');
    expect(cs).toContain('[assembly: AssemblyFileVersion("1.2.3.0")]');
    expect(cs).toContain('[assembly: AssemblyCopyright("Copyright (c) 2026 Riddhesh Markandeya")]');
  });

  test("a suffixed version keeps only its numeric part, which is all an assembly version takes", () => {
    expect(assemblyInfo({ title: "Grindlog", version: "1.2.3-rc.1" })).toContain('[assembly: AssemblyVersion("1.2.3.0")]');
  });

  test("escapes the title as a C# string", () => {
    expect(assemblyInfo({ title: String.raw`a"b\c`, version: "1.0.0" })).toContain(String.raw`AssemblyTitle("a\"b\\c")`);
  });
});

describe("findCsc", () => {
  test("prefers the 64-bit framework, then the 32-bit one, else null", () => {
    const has = (paths: string[]) => (p: string) => paths.includes(p);
    const x64 = String.raw`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`;
    const x86 = String.raw`C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`;
    expect(findCsc(String.raw`C:\Windows`, has([x64, x86]))).toBe(x64);
    expect(findCsc(String.raw`C:\Windows`, has([x86]))).toBe(x86);
    expect(findCsc(String.raw`C:\Windows`, has([]))).toBeNull();
    // An empty windir, not undefined: undefined takes the default, the machine's real WINDIR.
    expect(findCsc("", has([x64]))).toBeNull();
  });
});
