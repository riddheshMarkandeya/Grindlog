# WP9a review summary

Date: 2026-11-02. The full log is in the Review log of `docs/plans/2026-11-02-wp9a-friends-data.md`.

- Tier: Substantial (design tier; ~780 non-test lines). Three rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 (delta from `5b3a579`) ran code-review low, arch-reviewer (sonnet) and security-reviewer;
  round 3 ran code-review low and arch-reviewer (sonnet), with nits only. Security found nothing.
- Fixed:
  - A teammate reset caused by a playlist change keeps focus on the playlist select, and the flag
    behind it can't outlive its reset.
  - Soloqueue no longer resets on a session with no friend, so paging under it keeps it (the user
    revisited the plan's rule); the With select stays enabled while set.
  - Trends' reset of a stale `with` keeps the x axis.
  - Duo lines count decided matches only.
  - Parsed filters are memoized, so the reset effects run on a real change only.
  - `MINE` is shared with `friends.ts`; friends are listed by name on both pages; dead
    `Teammate.startedAt` removed; comment and import tidy-ups; `rowsOf` builds its predicate once.
- Deferred → BACKLOG: Trends offering friends who were only ever opponents (WP9b, user's call).
- Verified, no fix needed: the suggestions request reading history twice (personal-DB scale), the
  comma-joined list kept for trio stats, and the /simplify design calls listed in the log.
- Disputed: `add(d !== null, …)` kept, so the duo trigger reads like the others.
