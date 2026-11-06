# Pre-friends backlog fixes review summary

Date: 2026-11-05. Covers the nav-click redirect race (`useTransitions={false}`), the recap Matches
totals row being dropped, and the By playlist value cells no longer wrapping.

- Tier: Standard. By size it's Trivial (24 non-test lines), but the router change touches every
  navigation. Two rounds.
- Round 1: code-review medium, arch-reviewer (opus) and security-reviewer. Round 2 (the delta):
  code-review low. Security found nothing.
- Fixed:
  - The new e2e held every `/api/sessions/latest` request, not just the first. It now holds one
    (`{ times: 1 }`).
  - The test comment carried incident history.
- Deferred to the BACKLOG Watch list (the user's choice): `<Navigate>` replaces from a passive
  effect. A click that lands between the redirect's commit and that effect can still be
  overwritten. The router prop closes the transition window, which went red 4 runs in 10; the
  effect gap hasn't shown in any run (20/20 and 32/32 green). The trigger and an effect-time
  `window.location.pathname` guard are on the item.
- Verified, no fix needed:
  - The regression e2e is probabilistic: about 4 in 10 red before the fix. It was the best repro
    found. A simultaneous release and click at 6× went 0/20.
  - Nowrap on every By playlist value cell fits the narrow column: table vs section width
    254/288 at 320px, 247/281 at 900px, 347/381 at 1280px, with no page overflow.
- Disputed: widening the Matches left-align selector beyond `:is(thead, tbody)` is safe. No
  tfoot exists any more, and guarding against one coming back is YAGNI.
