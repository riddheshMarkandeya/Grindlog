// Which page transition a navigation gets, and whether a page's redirect still applies. Pure, so
// both take plain location shapes (React Router's Location and window.location both fit).

interface At {
  pathname: string;
  search: string;
}

/** A location as logged: path and search. */
export const where = (l: At): string => l.pathname + l.search;

export type TransitionStyle = "rise" | "crossfade";

/**
 * A new path rises; the same path under a new search (a filter) crossfades; anything else (hash or
 * state only) doesn't animate. Neither does a replace: that's a redirect, not a page change the
 * user made, and the start-up chain / → /recap → a session mustn't stack transitions.
 */
export function transitionStyle(prev: At, next: At, type: "POP" | "PUSH" | "REPLACE"): TransitionStyle | null {
  if (type === "REPLACE") return null;
  if (prev.pathname !== next.pathname) return "rise";
  return prev.search !== next.search ? "crossfade" : null;
}

// Both sides through the URL parser, so the browser's own escaping (it escapes ' in a query, which
// encodeURIComponent leaves alone) isn't read as the user having moved on.
const normal = (l: At) => {
  const u = new URL(l.pathname + l.search, "http://x");
  return u.pathname + u.search;
};

/**
 * A page's redirect applies only while the URL is still the one the page decided on: a click that
 * moved on during the wait wins.
 */
export const shouldRedirect = (rendered: At, current: At): boolean => normal(rendered) === normal(current);
