# Dropdowns and trio review summary

Date: 2026-11-22. Plan and full Review log: `docs/plans/2026-11-22-dropdowns-and-trio.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security: no findings.
  - Fixed:
    - The With button's accessible name was only "With". React Aria labels the trigger with the
      `SelectValue` id, and the button didn't render one. The label now renders inside `SelectValue`,
      and the e2e `dropdown()` helper requires a value before the label.
    - Clicking the Anyone or Soloqueue that was already set navigated anyway, which on Trends reset
      the x axis. It now just closes the list.
    - While a With tick loaded, Recap greyed friends based on the previous With's matches, and kept an
      enabled Share button carrying the old stats. On placeholder data, only the two-friend cap greys
      and Share is hidden. An e2e test that holds the request covers both.
    - Smaller fixes: the account picker's font rule no longer hits the Retry button, and stale
      "select" wording in the RecapPage focus comments was updated.
  - Kept, no fix needed:
    - TeammateFilter repeats Select's skeleton (it's controlled-open, multiple-choice, and has
      description slots).
    - Trends greying ignores the playlist (decision 10).
    - The Settings playlist labels don't focus the dropdown when clicked (a recorded deviation).
  - `/simplify` edits:
    - dropped an unused field;
    - one "nobody ruled out while loading" rule for both pages;
    - the key predicate compares everything but With;
    - a shared `withButton` e2e helper.
- Round 2 (delta): correctness, arch (sonnet) and security all came back clean.
- Raised to the user, then checked and not done: keep Recap's bar mounted and load only the body,
  in place of placeholder data. The bar's greying, Share and reset all read the With-filtered
  matches and summary, so a mounted bar would still need the previous detail and the same three
  guards. Decision 9 stands.
- Manual checks left: how the open/close motion feels, and the 768 and 1024px layouts.
