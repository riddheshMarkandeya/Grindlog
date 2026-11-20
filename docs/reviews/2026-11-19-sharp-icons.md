# Sharp icons review summary

Date: 2026-11-19. Plan, measurements and full Review log: `docs/plans/2026-11-19-sharp-icons.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security was clean.
  - Fixed:
    - A resource RVA outside the resource section gave a negative file offset, which made `subarray` read from
      the end of the file. It now fails with a sentence.
    - An intermittent DPI failure would flip the tray icons between two sizes. Now only a real reading reloads
      them, and each failure or recovery is logged once.
    - The lock retry was silent. It now prints one line after a retried success.
    - Tray.cs had a catch for an entry point that exists on every supported Windows. Removed.
    - Records: PROJECT_INDEX, the release map pointer, the BACKLOG flake wording, a Watch item for removing the
      repoint once Bun fixes its icon groups, and the measured byte offset.
  - `/simplify`: `parseIco` reads sizes only and shares `make-icons.ts`'s layout constants. The fix re-checks with
    the frames it already parsed. The tray's DPI source is a bool.
- Not changed, with reasons in the log:
  - The dev install doesn't catch a non-`StepFailed` error, the same as the tray build.
  - The fix runs before rcedit. rcedit is pinned, and the read-back after it fails the build loudly.
  - Merging the async retry helper with the server's sync `renameRetry`: outside this diff.
  - Polling the scale rather than `DisplaySettingsChanged`: the plan's choice, and the poll costs almost nothing.
- Round 2 (delta): correctness, arch (sonnet), security. Correctness and security were clean. Four arch nits were
  fixed: two plan-wording nits, a hand-built PE32+ test for the out-of-section guard, and `scripts/steps.test.ts`
  for the retry helper.
- Round 3 (delta, tests and docs only): correctness, arch (sonnet). No bugs. One count nit was fixed, and two test
  coverage nits are covered by the Windows integration test or the bun-only runner.
- Verified live, before review: the release exe and the installed 0.1.6 (Setup over 0.1.5, no `ie4uinit`) render
  sharp in the shell. The diff is 0.0 at 32/48 px, against 14–17 before. Both trays log `icons_loaded` at 20 px /
  120 dpi. After review, the user checked Start and the trays by eye ("much better"; Start "looks good"), and changed
  the scale live 125 → 150 → 175 → 125 %. Both trays logged `icons_loaded` `scale_changed` at px 20 → 24 → 28 → 20
  (dpi 120/144/168), within seconds of each change, with no `dpi_unavailable`.
- Known flake, pre-existing and in BACKLOG: tray.test.ts "goes red within ~5 s" overruns under full-suite load
  (1 of 5 runs before this change).
