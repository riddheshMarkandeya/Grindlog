# WP9b review summary

Date: 2026-11-02. The full log is in the Review log of `docs/plans/2026-11-02-wp9b-friends-page.md`.

- Tier: Substantial (design tier; ~1,560 non-test lines). Two rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 (delta from `ad51ed20`) ran code-review low, arch-reviewer (sonnet) and security-reviewer.
  Security found nothing in either round.
- Fixed:
  - Focus after Add or Never suggest goes to the next banner's Add, not the first. A third
    suggestion in the e2e seed shows the difference.
  - A failed background refetch keeps the landing's cards on screen, as the friend page does.
  - A removed friend's cached page is dropped, so returning to it in the app says they're not a
    friend.
  - A write never refetches the key its own answer just filled; `GET /api/friends` returns early
    with no friends.
  - A double nickname save is ignored; the Matches/Trends links show only for a friend who has
    been on your team; a failed never-suggest load says so with Retry.
  - Reuse: `streaks`, `sum` and `maxOrNull` from `aggregate.ts`; `z.enum(MODE_ORDER)`; the open/close
    focus effects merged into `useOpenFocus`; best/worst decide private-ness by playlist group.
- Verified, no fix needed: private sizes counting leavers (accepted at plan review), the full player
  scan in `readLobbies` (3 ms on 168 matches, timed), and the plan deviations listed in the log.
- Deferred or disputed: none.
