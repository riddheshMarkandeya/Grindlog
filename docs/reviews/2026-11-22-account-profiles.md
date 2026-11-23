# Account profiles review summary

Date: 2026-11-22. Plan and full Review log: `docs/plans/2026-11-22-account-profiles.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security was clean.
  - Fixed:
    - The picker's per-`mutate` callbacks only run for the last of several quick picks, so if a save went through
      and a later one failed, no page refreshed. `useSaveAccount` (`queries.ts`) now checks the saved account
      when the last pick settles.
    - The move off `/recap/:key` read the path from the render of the pick. It now reads the live path.
    - The header showed All while settings had no data. It now waits for the settings query.
    - One bad stored setting logged `bad_stored` on every scoped read. It now logs once per run.
    - Smaller fixes: a stale doc comment, a stale code comment, the latest-session query key moved into
      `queries.ts`, a shared `confirmedIds`, and a Results line about the query string.
  - `/simplify`: a `createOnce()` log helper replaces 4 copies of the same pattern, and `main.ts` shares its
    settings and ids stores with the API.
- Round 2 (delta): correctness, arch (sonnet) and security found 2 comment nits (fixed) and one harmless extra
  refetch in a rare fallback state (not changed).
- Deferred → BACKLOG Watch list: a second dashboard tab keeps its old picker value until a reload. The interaction
  contract doesn't cover multiple tabs, and no data is lost.
- Manual check left: two fast arrow presses in Chrome save the second option. Playwright's key presses are too
  slow to hit the race.
