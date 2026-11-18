// The location the pages are shown at. It follows the router's, through a view transition when the
// change is a page change: the old <main> is snapshotted, then the new location renders inside the
// transition's callback. The header reads the router's own location, so it moves at once.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type Location, type NavigationType, useLocation, useNavigationType } from "react-router";
import { transitionStyle, where } from "./logic/page-transition";

export interface Shown {
  location: Location;
  navigationType: NavigationType;
}

export function useShownLocation(): Shown {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [shown, setShown] = useState<Shown>({ location, navigationType });
  // The newest router location. A transition's callback reads this rather than what it was started
  // with, so a late callback (one a newer navigation skipped) can't put back an older location.
  const latest = useRef(shown);
  const from = shown.location;
  const style = from === location ? null : transitionStyle(from, location, navigationType);
  const animate = style !== null && typeof document.startViewTransition === "function";
  // Not animated: shown follows in this same render, so the old page never renders once more against
  // the new URL (and refetches what the navigation removed).
  if (from !== location && !animate) setShown({ location, navigationType });

  useEffect(() => {
    latest.current = { location, navigationType };
    if (!animate) return;
    document.documentElement.dataset.vt = style;
    console.debug("[grindlog] page/transition", { style, from: where(from), to: where(location) });
    const t = document.startViewTransition(() => {
      flushSync(() => {
        setShown(latest.current);
      });
    });
    // ready rejects with AbortError when a newer navigation skips this one (expected; its callback
    // still runs), and when the callback throws (logged as failed). Anything else, such as a
    // snapshot that couldn't be taken, means the page changed without the animation.
    t.ready.catch(() => undefined);
    t.finished.catch(() => undefined);
    t.updateCallbackDone.then(
      () => t.ready.catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn("[grindlog] page/transition_skipped", { to: where(location), error: String(error) });
      }),
      (error: unknown) => { console.warn("[grindlog] page/transition_failed", { to: where(location), error: String(error) }); },
    );
  }, [location, navigationType, animate, style, from]);

  return shown;
}
