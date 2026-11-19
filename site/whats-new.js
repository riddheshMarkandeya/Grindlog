// @ts-check
// The What's new box: GitHub's latest release, turned into what the box shows. Pure, so the unit
// tests import it; main.js does the fetching and the DOM.

/** @typedef {{ tag: string, date: string | null, html: string }} Release */

export const LATEST_API = "https://api.github.com/repos/riddheshMarkandeya/Grindlog/releases/latest";

/**
 * The release, or null when there's nothing worth showing. Releases are drafted with empty notes
 * and filled in by hand, so an empty body really happens; the static link stays then.
 * @param {unknown} json GitHub's answer with `Accept: application/vnd.github.html+json`.
 * @returns {Release | null}
 */
export function toRelease(json) {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  /** @type {Record<string, unknown>} */
  const r = /** @type {Record<string, unknown>} */ (json);
  const tag = r.tag_name;
  const html = r.body_html;
  if (typeof tag !== "string" || tag === "") return null;
  if (typeof html !== "string" || html.trim() === "") return null;
  return { tag, date: typeof r.published_at === "string" ? r.published_at : null, html };
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * "v0.1.6 · Nov 2026", or the tag alone when the date doesn't parse.
 * @param {Release} release
 */
export function releaseLabel({ tag, date }) {
  const at = date === null ? NaN : Date.parse(date);
  return Number.isNaN(at) ? tag : `${tag} · ${MONTH.format(at)}`;
}

/**
 * The notes without inline style attributes. GitHub puts one on each image, and the page's CSP
 * refuses them with a console error as soon as the markup is parsed, in any document the page
 * makes, so they go before parsing. GitHub's HTML double-quotes every attribute and escapes quotes
 * in text, so a quoted ` style="..."` can only be an attribute.
 * @param {string} html
 * @returns {string}
 */
export function dropInlineStyles(html) {
  return html.replace(/\sstyle="[^"]*"/g, "");
}
