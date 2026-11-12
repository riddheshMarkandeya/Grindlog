import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RELEASES_API } from "../../shared/release";
import { feedSource, fetchLatest, parseRelease, pickCandidate, type Release } from "./feed";

const GITHUB = feedSource({});
/** jedisct1/minisign's real releases/latest response (2026-11-12), trimmed to two assets. */
const realJson = (): Record<string, unknown> => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "github-latest.json"), "utf8")) as Record<string, unknown>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-feed-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("feedSource", () => {
  test("GitHub's latest release unless GRINDLOG_UPDATE_FEED says otherwise", () => {
    expect(feedSource({})).toEqual({ kind: "http", url: RELEASES_API });
    expect(feedSource({ GRINDLOG_UPDATE_FEED: "" })).toEqual({ kind: "http", url: RELEASES_API });
  });

  test("an http(s) override is fetched the same way", () => {
    expect(feedSource({ GRINDLOG_UPDATE_FEED: "http://127.0.0.1:8000/latest.json" })).toEqual({ kind: "http", url: "http://127.0.0.1:8000/latest.json" });
  });

  test("anything else is a folder holding latest.json", () => {
    expect(feedSource({ GRINDLOG_UPDATE_FEED: "D:\\feed" })).toEqual({ kind: "folder", dir: "D:\\feed" });
  });
});

describe("parseRelease", () => {
  test("reads the fields it uses from a real GitHub response and ignores the rest", () => {
    expect(parseRelease(realJson(), GITHUB)).toEqual({
      ok: true,
      release: {
        tag: "0.12",
        draft: false,
        prerelease: false,
        assets: [
          { name: "minisign-0.12-win64.zip", size: 252505, url: "https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-win64.zip" },
          { name: "minisign-0.12-win64.zip.minisig", size: 318, url: "https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-win64.zip.minisig" },
        ],
      },
    });
  });

  test("a response missing a field it needs is an error naming the field", () => {
    const json = realJson();
    delete json.tag_name;
    const parsed = parseRelease(json, GITHUB);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(/tag_name/);
  });

  test("a folder feed's asset names resolve inside the folder", () => {
    const json = { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "a.exe", size: 3, browser_download_url: "a.exe" }] };
    expect(parseRelease(json, { kind: "folder", dir })).toEqual({ ok: true, release: { tag: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "a.exe", size: 3, url: join(dir, "a.exe") }] } });
  });

  test.each(["..\\a.exe", "sub/a.exe", "C:\\a.exe", "\\\\host\\share\\a.exe", "..", "https://example.com/a.exe"])("a folder feed refuses the asset url %j", (url) => {
    const json = { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "a.exe", size: 3, browser_download_url: url }] };
    expect(parseRelease(json, { kind: "folder", dir }).ok).toBe(false);
  });

  test("GitHub's feed allows only https asset urls; an http override allows http too", () => {
    const json = (url: string) => ({ tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "a.exe", size: 3, browser_download_url: url }] });
    expect(parseRelease(json("file:///C:/a.exe"), GITHUB).ok).toBe(false);
    expect(parseRelease(json("http://127.0.0.1/a.exe"), GITHUB).ok).toBe(false);
    expect(parseRelease(json("http://127.0.0.1/a.exe"), { kind: "http", url: "http://127.0.0.1/latest.json" }).ok).toBe(true);
    expect(parseRelease(json("file:///C:/a.exe"), { kind: "http", url: "http://127.0.0.1/latest.json" }).ok).toBe(false);
  });
});

describe("fetchLatest", () => {
  interface Seen {
    url: string;
    headers: Headers;
  }
  const fakeFetch = (respond: () => Response) => {
    const seen: Seen[] = [];
    const fetch = (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers) });
      return Promise.resolve(respond());
    };
    return { fetch, seen };
  };

  test("asks GitHub with the API headers and returns the release and its ETag", async () => {
    const { fetch, seen } = fakeFetch(() => new Response(JSON.stringify(realJson()), { headers: { ETag: 'W/"abc"' } }));
    const got = await fetchLatest(GITHUB, { fetch });
    expect(got).toMatchObject({ kind: "release", etag: 'W/"abc"', release: { tag: "0.12" } });
    expect(seen[0]?.url).toBe(RELEASES_API);
    expect(seen[0]?.headers.get("User-Agent")).toBe("Grindlog-updater");
    expect(seen[0]?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(seen[0]?.headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(seen[0]?.headers.get("If-None-Match")).toBeNull();
  });

  test("sends a saved ETag and reads a 304 as not modified", async () => {
    const { fetch, seen } = fakeFetch(() => new Response(null, { status: 304 }));
    expect(await fetchLatest(GITHUB, { fetch, etag: 'W/"abc"' })).toEqual({ kind: "not_modified" });
    expect(seen[0]?.headers.get("If-None-Match")).toBe('W/"abc"');
  });

  test("a rate limit is an error with the reset time", async () => {
    const { fetch } = fakeFetch(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1762950000" } }));
    expect(await fetchLatest(GITHUB, { fetch })).toEqual({ kind: "error", status: 403, rateLimitReset: 1762950000, error: "HTTP 403" });
  });

  test("another HTTP status, a bad body and a network failure are errors", async () => {
    expect(await fetchLatest(GITHUB, fakeFetch(() => new Response("", { status: 500 })))).toEqual({ kind: "error", status: 500, error: "HTTP 500" });
    expect(await fetchLatest(GITHUB, fakeFetch(() => new Response("<html>")))).toMatchObject({ kind: "error", status: 200 });
    const failing = { fetch: () => Promise.reject(new TypeError("fetch failed")) };
    expect(await fetchLatest(GITHUB, failing)).toMatchObject({ kind: "error", error: expect.stringMatching(/fetch failed/) as unknown });
  });

  test("a folder feed reads latest.json, and a missing one is an error", async () => {
    expect(await fetchLatest({ kind: "folder", dir }, {})).toMatchObject({ kind: "error" });
    writeFileSync(join(dir, "latest.json"), JSON.stringify({ tag_name: "v0.2.0", draft: false, prerelease: false, assets: [] }));
    expect(await fetchLatest({ kind: "folder", dir }, {})).toEqual({ kind: "release", release: { tag: "v0.2.0", draft: false, prerelease: false, assets: [] } });
  });
});

describe("pickCandidate", () => {
  const defaultNames = (tag: string) => [`Grindlog-Setup-${tag.slice(1)}.exe`, `Grindlog-Setup-${tag.slice(1)}.exe.minisig`];
  const release = (tag: string, names: string[] = defaultNames(tag), extra: Partial<Release> = {}): Release => ({
    tag,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({ name, size: 10, url: `https://x/${name}` })),
    ...extra,
  });

  test("a newer release with both assets is the candidate", () => {
    expect(pickCandidate(release("v0.2.0"), "0.1.0", [])).toEqual({
      kind: "candidate",
      version: "0.2.0",
      installer: { name: "Grindlog-Setup-0.2.0.exe", size: 10, url: "https://x/Grindlog-Setup-0.2.0.exe" },
      signature: { name: "Grindlog-Setup-0.2.0.exe.minisig", size: 10, url: "https://x/Grindlog-Setup-0.2.0.exe.minisig" },
    });
  });

  test("the same or an older version is up to date (never downgrades)", () => {
    expect(pickCandidate(release("v0.1.0"), "0.1.0", [])).toEqual({ kind: "up_to_date", version: "0.1.0" });
    expect(pickCandidate(release("v0.0.9"), "0.1.0", [])).toEqual({ kind: "up_to_date", version: "0.0.9" });
  });

  test("a running rc compares by its numeric part, so the same numeric final isn't offered", () => {
    expect(pickCandidate(release("v0.2.0"), "0.2.0-rc.1", [])).toEqual({ kind: "up_to_date", version: "0.2.0" });
  });

  test("a prerelease, a draft or a suffixed tag is never offered", () => {
    expect(pickCandidate(release("v0.3.0", undefined, { prerelease: true }), "0.1.0", [])).toEqual({ kind: "up_to_date", version: "0.3.0" });
    expect(pickCandidate(release("v0.3.0", undefined, { draft: true }), "0.1.0", [])).toEqual({ kind: "up_to_date", version: "0.3.0" });
    expect(pickCandidate(release("v0.3.0-rc.1"), "0.1.0", [])).toEqual({ kind: "up_to_date", version: "0.3.0-rc.1" });
  });

  test("a version skipped before stays skipped", () => {
    expect(pickCandidate(release("v0.2.0"), "0.1.0", ["0.2.0"])).toEqual({ kind: "skipped_before", version: "0.2.0" });
  });

  test("a missing installer or signature waits for the next check", () => {
    expect(pickCandidate(release("v0.2.0", ["Grindlog-Setup-0.2.0.exe"]), "0.1.0", [])).toEqual({ kind: "assets_missing", version: "0.2.0", have: ["Grindlog-Setup-0.2.0.exe"] });
    expect(pickCandidate(release("v0.2.0", ["Grindlog-Setup-0.2.0.exe.minisig", "grindlog-0.2.0.exe"]), "0.1.0", [])).toMatchObject({ kind: "assets_missing" });
  });

  test.each(["0.2.0", "release-0.2.0", "v0.2", "v.0.2.0"])("a tag that isn't v<version> (%j) is a bad tag", (tag) => {
    expect(pickCandidate(release(tag, []), "0.1.0", [])).toEqual({ kind: "bad_tag", tag });
  });
});
