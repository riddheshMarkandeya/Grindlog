import { type RefObject, useLayoutEffect } from "react";

/**
 * One sliding selection indicator per group: measures the active child and writes its place to the
 * container as --ind-pos and --ind-size, which the module draws as the container's ::after.
 *
 * data-ind on the container: "placed" for the first measure (no transition, so nothing slides in
 * from 0), "live" a frame later (only live carries the transition), "none" with no active child
 * (the indicator fades out). Coming back from none it fades in at the new item rather than sliding
 * from its old spot. The module drops the items' own highlight under any data-ind, so before the
 * first measure the static highlight still shows. The container must be positioned, so offsets are
 * measured from it.
 */
export function useIndicator(ref: RefObject<HTMLElement | null>, activeSelector: string, axis: "x" | "y", activeKey: unknown): void {
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let frame = 0;
    const measure = () => {
      const active = host.querySelector<HTMLElement>(activeSelector);
      if (!active) {
        cancelAnimationFrame(frame);
        host.dataset.ind = "none";
        return;
      }
      const pos = axis === "x" ? active.offsetLeft : active.offsetTop;
      const size = axis === "x" ? active.offsetWidth : active.offsetHeight;
      const [p, s] = [`${String(pos)}px`, `${String(size)}px`];
      const state = host.dataset.ind;
      // A resize that didn't move the item (most of them) writes nothing.
      if (state === "live" && host.style.getPropertyValue("--ind-pos") === p && host.style.getPropertyValue("--ind-size") === s) return;
      host.style.setProperty("--ind-pos", p);
      host.style.setProperty("--ind-size", s);
      if (state === "live") return;
      // From none the place is written while hidden (none transitions opacity only), so going live
      // fades the indicator in where it now is.
      if (state !== "none") host.dataset.ind = "placed";
      // Commit this place as the starting style now: otherwise the frame below can land in the same
      // style pass, and live would slide in from wherever the last flush left it.
      getComputedStyle(host, "::after").getPropertyValue("translate");
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        host.dataset.ind = "live";
      });
    };
    measure();
    // Font load, wrapping and a resized page move the items without changing the selection. The
    // children too: a capped-height list (the rail) doesn't resize when rows come or go above the
    // active one, but the list inside it does.
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const child of host.children) observer.observe(child);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, activeSelector, axis, activeKey]);
}
