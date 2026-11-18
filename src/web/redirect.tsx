// Replace-redirects that apply only while the URL is still the one the page decided on. A redirect
// decided on a load (or a request) that lands after the user clicked elsewhere would otherwise
// replace their click: the URL has moved on, so the redirect is skipped and logged.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, type Location, type NavigateFunction, type NavigateOptions } from "react-router";
import { shouldRedirect, where } from "./logic/page-transition";

/** `rendered`: the location the page decided on, its own useLocation(). */
export function redirect(navigate: NavigateFunction, to: string, rendered: Pick<Location, "pathname" | "search">, opts: Omit<NavigateOptions, "replace"> = {}): void {
  const at = window.location;
  if (!shouldRedirect(rendered, at)) {
    console.info("[grindlog] redirect/skipped", { to, rendered: where(rendered), at: where(at) });
    return;
  }
  void navigate(to, { ...opts, replace: true });
}

/** `<Navigate replace>` with the check above. */
export function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  const rendered = useLocation();
  // Once per target and location: StrictMode's second effect run would find the URL already moved
  // by the first and log a skip that never happened. A new target or location still fires.
  const fired = useRef<string | null>(null);
  useEffect(() => {
    const key = `${to} ${where(rendered)}`;
    if (fired.current === key) return;
    fired.current = key;
    redirect(navigate, to, rendered);
  }, [navigate, to, rendered]);
  return null;
}
