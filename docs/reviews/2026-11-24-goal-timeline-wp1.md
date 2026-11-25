# Goal timeline WP1 review summary

Date: 2026-11-24. Plan and full Review log: `docs/plans/2026-11-24-goal-timeline.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security: no findings.
  - Fixed:
    - The regulation-start fill for a moment before the first reading didn't check that the first reading is the
      start tick. It now fills only when that reading is within 2 s of the length; otherwise the moment stays null
      and is flagged. Rules-diff on the dev data was unchanged.
    - Extras that threw read as "computed, no moments"; `readMoments` now returns null for them.
    - `screens-data.ts` crashed on a dev DB from before this migration; tables the copy lacks are skipped.
    - The statfeed-name lookup hit inherited object keys; it's a `Map` now.
    - The recompute parity test didn't cover `match_moments`.
    - Type and kind-list drift (`MomentPoint`, `MOMENT_KIND_IDS`), and stale or ambiguous wording in four places.
  - Verified, no fix needed:
    - `forfeit_end_clocked` skips joined matches: 2 of the 3 joined forfeits were joined after the vote and have
      no Win.
    - Goals before the first reading don't get the fill: that would change the shipped `goal_clock` rule, and
      `goals_clocked` flags it.
  - `/simplify` edits: `Acc.ending` was dropped for `facts.sawWin`, the kind sets were hoisted, and a `clockCols`
    helper replaced three hand-unpacked clocks. Five suggestions were skipped (the reasons are in the plan).
- Round 2 (delta only): correctness-reviewer, arch-reviewer (sonnet), security-reviewer. Two wording nits, fixed.
  Review closed.
