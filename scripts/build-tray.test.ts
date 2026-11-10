import { describe, expect, test } from "vitest";
import { assemblyInfo, findCsc, trayCompileArgs } from "./build-tray";

describe("trayCompileArgs", () => {
  const args = trayCompileArgs({
    out: String.raw`C:\bin\grindlog-dev-tray.new.exe`,
    icon: String.raw`C:\repo\favicon.ico`,
    sources: [String.raw`C:\repo\src\tray\Tray.cs`, String.raw`C:\tmp\AssemblyInfo.cs`],
  });

  test("an optimised windowed exe with the icon as both file icon and the tray's resource", () => {
    expect(args).toEqual([
      "/nologo",
      "/target:winexe",
      "/optimize+",
      String.raw`/win32icon:C:\repo\favicon.ico`,
      String.raw`/resource:C:\repo\favicon.ico,Grindlog.tray.ico`,
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
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
    expect(findCsc(undefined, has([x64]))).toBeNull();
  });
});
