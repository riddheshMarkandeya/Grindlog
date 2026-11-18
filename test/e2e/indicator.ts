// The sliding selection indicator is its group's ::after; useIndicator writes the place to --ind-pos
// and the state to data-ind. The e2e project has no DOM types, so the little browser API these
// helpers touch is typed here.
import type { Locator } from "@playwright/test";

interface Style { getPropertyValue(name: string): string; transitionDuration: string; transitionProperty: string }
interface Win { getComputedStyle(el: unknown, pseudo?: string): Style }
interface El { offsetLeft: number; offsetTop: number; addEventListener(type: string, fn: () => void, opts: { once: boolean }): void }

export const indPos = (group: Locator) => group.evaluate((el) => (globalThis as unknown as Win).getComputedStyle(el).getPropertyValue("--ind-pos").trim());
export const leftOf = async (item: Locator) => `${String(await item.evaluate((el) => (el as unknown as El).offsetLeft))}px`;
export const topOf = async (item: Locator) => `${String(await item.evaluate((el) => (el as unknown as El).offsetTop))}px`;

/** Resolves on the group's next transitionend (the indicator's, since items don't move). */
export const transitionEnd = (group: Locator) =>
  group.evaluate((el) => new Promise<void>((resolve) => { (el as unknown as El).addEventListener("transitionend", resolve, { once: true }); }));

/** The indicator's computed transition-duration for one property. */
export const indDuration = (group: Locator, prop: string) =>
  group.evaluate((el, p) => {
    const s = (globalThis as unknown as Win).getComputedStyle(el, "::after");
    return s.transitionDuration.split(", ")[s.transitionProperty.split(", ").indexOf(p)];
  }, prop);
