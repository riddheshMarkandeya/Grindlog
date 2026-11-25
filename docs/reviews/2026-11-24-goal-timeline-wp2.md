# Goal timeline WP2 review summary

Date: 2026-11-25. Plan and full Review log: `docs/plans/2026-11-24-goal-timeline.md` (WP2 rounds 1–3).

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security: no findings.
  - Fixed:
    - A match flagged `clock_overtime_flagged` was still drawn, so an overtime goal could land in regulation. That
      flag hides the timeline now.
    - A goal whose scorer is on the other team would draw one side's icon while the score counted it for the other.
      None of 1,988 stored goals. The timeline hides such a match, and BACKLOG has a Watch item.
    - The screen-reader read-out ran in row order at a shared second, and left out the overtime start and the
      forfeit or "You left" stop. `readOut` puts them in time order.
    - Names were cut through an emoji. They're cut by grapheme now.
    - On a narrow chart the end-of-regulation tick label could be skipped. Labels are counted from the end now.
    - The score format was written twice.
    - `HIDING_FLAGS` had untested copies of the server's check ids. They're tested against `CHECK_IDS` now.
    - The analytics map's "Built" status hid row C's unbuilt parts. It names them as next now.
  - `/simplify`: seven small edits (memoization, one player map, push instead of copy, and the like). Larger
    refactors were skipped, with reasons in the plan.
- Round 2: correctness-reviewer, arch-reviewer (sonnet), security-reviewer.
  - Fixed: a regulation goal at 0:00 read after "Overtime". Marks now carry their clock's overtime flag.
- Round 3: correctness-reviewer, security-reviewer. No findings.
- Deferred: none. Disputed: none.
