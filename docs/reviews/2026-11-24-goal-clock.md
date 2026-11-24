# Goal clock review summary

Date: 2026-11-24. Plan and full Review log: `docs/plans/2026-11-24-goal-clock.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`.
  - Security: no findings.
  - Fixed:
    - A reading whose `bOvertime` isn't a boolean was taken as regulation unflagged, and could also raise the
      regulation length. It's now counted and flagged by a new check, `clock_overtime_flagged` (plan review #8 had
      chosen a Watch item only; the regulation-length effect wasn't weighed then). No such reading in raw.db.
    - The `regulation_length` and `goal_clock` evidence counts didn't add up; re-derived from the stored matches
      (the 372-s match is in raw.db but not stored).
    - The handler's after-MatchEnded guard had no test or comment; both added, and the test was confirmed red with
      the guard removed.
    - A negative largest reading gave a `-0` length; only readings above 0 count now.
    - A missing doc comment on `goalsWithoutClock`.
  - Verified, no fix needed: a joined-in-progress match can store a short regulation length. Accepted in the design;
    the timeline build must gate on `joined_in_progress` before placing goals by elapsed time.
  - `/simplify` edits: the regulation length is kept as a running value in the handler; the two causes got one
    check each.
  - Skipped `/simplify` suggestions: skipping every event after MatchEnded in the dispatch loop (changes other
    handlers), a shared clock-parse helper, a column table for goal inserts, a stored elapsed time, and smaller
    type reshuffles (wider than this diff or against storing the reading as read).
- Round 2 (delta only): correctness-reviewer, arch-reviewer (sonnet), security-reviewer. No findings beyond 2 wording
  nits (the `regulation_length` text now says why the new check is attached; the plan's Design section notes what the
  Review log superseded). Review closed.
