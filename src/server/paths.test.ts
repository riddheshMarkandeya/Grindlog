import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { dashboardPort, dataDir, identity, logsDir, staticDir } from "./paths";

describe("identity", () => {
  test("prod is a friend's install", () => {
    expect(identity("prod")).toEqual({ dataDirName: "Grindlog", port: 49100, exe: "grindlog.exe", task: "Grindlog", shortcut: "Grindlog.url" });
  });

  test("dev shares none of prod's names or its port, so both can be installed side by side", () => {
    expect(identity("dev")).toEqual({ dataDirName: "GrindlogDev", port: 49102, exe: "grindlog-dev.exe", task: "GrindlogDev", shortcut: "Grindlog Dev.url" });
  });

  test("an unbundled run is dev", () => {
    expect(identity()).toEqual(identity("dev"));
  });
});

describe("dataDir", () => {
  test("GRINDLOG_DATA_DIR wins", () => {
    expect(dataDir({ GRINDLOG_DATA_DIR: "D:\\x", LOCALAPPDATA: "C:\\L" })).toBe("D:\\x");
  });

  test("LOCALAPPDATA\\GrindlogDev otherwise, in a dev build", () => {
    expect(dataDir({ LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "GrindlogDev"));
  });

  test("LOCALAPPDATA\\Grindlog in a prod build", () => {
    expect(dataDir({ LOCALAPPDATA: "C:\\L" }, "prod")).toBe(join("C:\\L", "Grindlog"));
  });

  test("falls back to the home dir when LOCALAPPDATA is missing", () => {
    expect(dataDir({})).toBe(join(homedir(), "AppData", "Local", "GrindlogDev"));
  });

  test("an empty LOCALAPPDATA counts as missing, so the path never goes relative", () => {
    expect(dataDir({ LOCALAPPDATA: "" })).toBe(join(homedir(), "AppData", "Local", "GrindlogDev"));
  });
});

describe("logsDir", () => {
  test("a logs folder inside the data dir", () => {
    expect(logsDir({ GRINDLOG_DATA_DIR: "D:\\x" })).toBe(join("D:\\x", "logs"));
    expect(logsDir({ LOCALAPPDATA: "C:\\L" }, "prod")).toBe(join("C:\\L", "Grindlog", "logs"));
  });
});

describe("dashboardPort", () => {
  test("49102 in a dev build and 49100 in prod; GRINDLOG_PORT moves it (a dev run beside the background one)", () => {
    expect(dashboardPort({})).toBe(49102);
    expect(dashboardPort({}, "prod")).toBe(49100);
    expect(dashboardPort({ GRINDLOG_PORT: "49101" })).toBe(49101);
  });

  test("a port that isn't a whole number in 1-65535 fails at startup", () => {
    for (const bad of ["", "abc", "0", "65536", "49101.5", "-1", " 49101x"]) {
      expect(() => dashboardPort({ GRINDLOG_PORT: bad }), bad).toThrow(/GRINDLOG_PORT/);
    }
  });
});

describe("staticDir", () => {
  test("GRINDLOG_STATIC_DIR wins", () => {
    expect(staticDir({ GRINDLOG_STATIC_DIR: "D:/rl/dist", GRINDLOG_DATA_DIR: "D:\\x" })).toBe("D:/rl/dist");
  });

  test("defaults to the web build beside the installed exe, following the data dir", () => {
    expect(staticDir({ GRINDLOG_DATA_DIR: "D:\\x" })).toBe(join("D:\\x", "bin", "web"));
    expect(staticDir({ LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "GrindlogDev", "bin", "web"));
    expect(staticDir({ LOCALAPPDATA: "C:\\L" }, "prod")).toBe(join("C:\\L", "Grindlog", "bin", "web"));
  });

  test("an empty GRINDLOG_STATIC_DIR counts as unset", () => {
    expect(staticDir({ GRINDLOG_STATIC_DIR: "", LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "GrindlogDev", "bin", "web"));
  });
});
