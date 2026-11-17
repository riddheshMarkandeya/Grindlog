# Contribution stats review summary

Date: 2026-11-16/17. Plan and full Review log: `docs/plans/2026-11-16-contribution-stats.md`.

## Package A (data: the `touch_thirds` rule, the read layer, `shared/contribution.ts`, the API)
- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`. Round 2 (delta):
  correctness, arch (sonnet), security.
- 14 fixed, 3 verified, 1 deferred to package B's e2e, 7 simplify items skipped. The main fixes: touch shares
  got their own match count (`Carry.touchMatches`); "not computed" became null instead of zeros beside a flag;
  a type-level import cycle broke out into `shared/lobby.ts`.

## Package B (UI: the shared bars, the recap's Contribution and touches, the match page, goal names)
- Round 1: the same four passes. Security was clean, and there were no bugs that lose data.
  - Rounding: segments now add up to exactly 100 (`wholeShares`, largest remainder), so bars fill and the
    rest's label matches its width.
  - The Touches row says "no touch data yet" rather than "none" before a recompute.
  - The By playlist rows are one shared component; the rest-of-team label has one rule.
  - Copy, comment and stylesheet tidy-ups; `pctText` and `evenShare` replace hand-written duplicates.
- The real-browser pass (carbon, slate, OLED; 1280px and 320px) found two layout bugs the e2e missed: touch
  row names cut off, and % labels clipped mid-number at 320px (an 18% third read "1"). Labels now show only
  where their segment fits them (CSS container queries), with a 320px e2e guarding it.
- Not changed, with reasons in the log: the second list of off-pitch playlist ids (playlist groups don't
  encode the arena); the 760px goal map cap on the recap; neutral greys for a spectated match's touch rows
  (blue and orange mean your side and theirs).
- Round 2 (delta): correctness, arch (sonnet), security. Clean apart from 6 nits, all fixed.
- 23 fixed, 3 verified, 5 simplify items skipped, nothing deferred.
