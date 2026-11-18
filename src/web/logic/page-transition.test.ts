import { describe, expect, test } from "vitest";
import { shouldRedirect, transitionStyle } from "./page-transition";

const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

describe("transitionStyle", () => {
  test("a new page rises", () => {
    expect(transitionStyle(at("/recap/a"), at("/trends"), "PUSH")).toBe("rise");
    expect(transitionStyle(at("/trends"), at("/recap/a"), "POP")).toBe("rise");
  });
  test("the same page under a new filter crossfades", () => {
    expect(transitionStyle(at("/trends", "?kind=week"), at("/trends", "?kind=month"), "PUSH")).toBe("crossfade");
  });
  test("a hash or state-only change, and the same URL, don't animate", () => {
    expect(transitionStyle(at("/trends", "?a=1"), at("/trends", "?a=1", "#x"), "PUSH")).toBeNull();
    expect(transitionStyle(at("/trends"), at("/trends"), "PUSH")).toBeNull();
  });
  test("a replace is a redirect, not a page change the user made", () => {
    expect(transitionStyle(at("/"), at("/recap"), "REPLACE")).toBeNull();
    expect(transitionStyle(at("/trends", "?a=1"), at("/trends", "?a=2"), "REPLACE")).toBeNull();
  });
});

describe("shouldRedirect", () => {
  test("only while the URL is still the one the page decided on", () => {
    expect(shouldRedirect(at("/recap", "?filter=ranked"), at("/recap", "?filter=ranked"))).toBe(true);
    expect(shouldRedirect(at("/recap"), at("/friends"))).toBe(false);
    expect(shouldRedirect(at("/trends", "?a=1"), at("/trends", "?a=2"))).toBe(false);
  });
  test("a hash doesn't count", () => {
    expect(shouldRedirect(at("/recap"), at("/recap", "", "#top"))).toBe(true);
  });
  test("the browser's own escaping of a URL the app built doesn't count as moving on", () => {
    // encodeURIComponent leaves ' alone; the browser's URL parser escapes it in a query.
    expect(shouldRedirect(at("/recap/a", "?with=Epic%7Co'b"), at("/recap/a", "?with=Epic%7Co%27b"))).toBe(true);
    expect(shouldRedirect(at("/recap/it's"), at("/recap/it's"))).toBe(true);
  });
});
