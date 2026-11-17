// Pieces both Friends pages use: failed writes logged, and focus moved by code.
import { useEffect, useRef, type RefObject } from "react";
import { ApiError } from "../../api";

/** Logged on every failed friends write, with the server's code. */
export function warnFailed(action: string, error: unknown) {
  console.warn("[grindlog] friends/save_failed", { action, code: error instanceof ApiError ? error.code : String(error) });
}

/** Focus moved by code, logged so a jump the user didn't expect can be traced. */
export function focusTo(el: HTMLElement | null | undefined, to: string, page: string) {
  if (!el) return;
  console.debug("[grindlog] friends/focus", { to, page });
  el.focus();
}

/** An inline form or confirm: focus goes into it on open, and back to its trigger on close. */
export function useOpenFocus(open: boolean, inside: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>, what: string) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) focusTo(inside.current, `${what}_open`, "friend");
    else if (wasOpen.current) focusTo(trigger.current, `${what}_closed`, "friend");
    wasOpen.current = open;
  }, [open, inside, trigger, what]);
}
