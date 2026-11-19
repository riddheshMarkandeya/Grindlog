// @ts-check
// The page's behaviour: What's new from GitHub, the screenshot lightbox, and the scroll reveal.
import { dropInlineStyles, LATEST_API, releaseLabel, toRelease } from "./whats-new.js";

/**
 * @template {Element} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
function byId(id, type) {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} is missing`);
  return el;
}

/** Links from release notes open in a new tab, like every other external link on the page. */
function externalLinks(/** @type {ParentNode} */ root) {
  for (const a of root.querySelectorAll("a[href]")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  }
}

// The page has no server, so the console is its only log. Any failure leaves the static link.
async function whatsNew() {
  const release = await fetchRelease();
  if (typeof release === "string") {
    console.warn("[whats-new]", release);
    return;
  }
  byId("news-label", HTMLElement).textContent = releaseLabel(release);
  const body = byId("news-body", HTMLElement);
  // GitHub sanitizes body_html, and the CSP allows no script that isn't this site's own.
  body.innerHTML = dropInlineStyles(release.html);
  externalLinks(body);
  body.hidden = false;
}

/**
 * The latest release, or why there isn't one to show.
 * @returns {Promise<import("./whats-new.js").Release | string>}
 */
async function fetchRelease() {
  /** @type {unknown} */
  let json;
  try {
    // This Accept value is CORS-safelisted, and GitHub answers with body_html already sanitized.
    const res = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github.html+json" } });
    if (!res.ok) return `HTTP ${String(res.status)}`;
    json = await res.json();
  } catch (err) {
    // A network failure, or an answer that isn't JSON.
    return err instanceof Error ? err.message : String(err);
  }
  return toRelease(json) ?? "no release notes";
}

function lightbox() {
  const dialog = byId("lightbox", HTMLDialogElement);
  const img = byId("lightbox-img", HTMLImageElement);
  const caption = byId("lightbox-caption", HTMLElement);
  for (const button of document.querySelectorAll(".zoom")) {
    const shot = button.querySelector("img");
    if (shot === null) continue;
    button.addEventListener("click", () => {
      // The src attribute, not currentSrc: always the full-size screen, never the phone crop.
      img.src = shot.getAttribute("src") ?? "";
      img.alt = shot.alt;
      caption.textContent = shot.alt;
      dialog.showModal();
    });
  }
  dialog.querySelector("button")?.addEventListener("click", () => {
    dialog.close();
  });
  // A backdrop click lands on the dialog element too, so tell it apart by position: a click
  // inside the dialog's box (beside a narrow image, say) keeps it open.
  dialog.addEventListener("click", (e) => {
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dialog.close();
  });
}

// Each block rises in once as it scrolls into view. html.js, which hides the blocks until then, is
// set here, by the code that shows them again: if this script fails to load or run, nothing hides.
// Blocks below the fold don't flash, as they aren't painted yet.
function reveal() {
  document.documentElement.classList.add("js");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const el of document.querySelectorAll(".reveal")) io.observe(el);
}

// Reveal first, so a failure in the others can't leave blocks hidden.
reveal();
lightbox();
void whatsNew();
