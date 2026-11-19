// The landing page's What's new box: turning GitHub's latest-release answer into what it shows.
import { describe, expect, test } from "vitest";
import { dropInlineStyles, releaseLabel, toRelease } from "../site/whats-new.js";

const full = { tag_name: "v0.1.6", published_at: "2026-11-20T18:00:00Z", body_html: "<ul><li>New seasons arrive on their own.</li></ul>" };

describe("toRelease", () => {
  test("a full release gives its tag, date and notes", () => {
    expect(toRelease(full)).toEqual({ tag: "v0.1.6", date: "2026-11-20T18:00:00Z", html: full.body_html });
  });

  test("a release without a date still shows", () => {
    expect(toRelease({ ...full, published_at: null })).toEqual({ tag: "v0.1.6", date: null, html: full.body_html });
  });

  test.each([
    ["no body_html", { tag_name: "v1", published_at: null }],
    ["an empty body_html", { ...full, body_html: "" }],
    ["a whitespace body_html", { ...full, body_html: " \n\t " }],
    ["a non-string body_html", { ...full, body_html: 3 }],
    ["no tag", { published_at: full.published_at, body_html: full.body_html }],
    ["an empty tag", { ...full, tag_name: "" }],
  ])("%s gives null", (_, json) => {
    expect(toRelease(json)).toBeNull();
  });

  test.each([null, undefined, "v1", 42, ["v1"]])("a non-object (%j) gives null", (json) => {
    expect(toRelease(json)).toBeNull();
  });
});

describe("releaseLabel", () => {
  test("is the tag and the month it came out", () => {
    expect(releaseLabel({ tag: "v0.1.6", date: "2026-11-20T18:00:00Z", html: "" })).toBe("v0.1.6 · Nov 2026");
  });

  test("is the tag alone without a usable date", () => {
    expect(releaseLabel({ tag: "v0.1.6", date: null, html: "" })).toBe("v0.1.6");
    expect(releaseLabel({ tag: "v0.1.6", date: "soon", html: "" })).toBe("v0.1.6");
  });
});

describe("dropInlineStyles", () => {
  test("drops each style attribute GitHub puts on images, keeping the rest of the tag", () => {
    expect(dropInlineStyles('<p><img src="a.png" alt="A" style="max-width: 100%;"> and <img style="x" src="b.png"></p>')).toBe(
      '<p><img src="a.png" alt="A"> and <img src="b.png"></p>',
    );
  });

  test("leaves text that only mentions style alone, since GitHub escapes quotes in text", () => {
    const html = "<pre><code>&lt;img style=&quot;x&quot;&gt; style=wide</code></pre>";
    expect(dropInlineStyles(html)).toBe(html);
  });
});
