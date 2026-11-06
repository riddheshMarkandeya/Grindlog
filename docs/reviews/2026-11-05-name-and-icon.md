# Review: name and app icon (friends release step 2)

Plan and full Review log: `docs/plans/2026-11-05-name-and-icon.md`. Standard by the actual diff: 3 rounds,
6 fixed, 2 deferred, 2 disputed. Security found nothing in any round it ran.

## Main changes from review
- The share card's mark is inlined through a Vite import. As a fetched file, one failed fetch would have
  broken every export until a reload.
- The header uses the small drawing, because the master looks muddy at 20 px on a 1x display.
- Replacing and removing shortcuts now has tests against a temp `APPDATA`.

## Deferred to the BACKLOG Watch list
- `IconFile` written as UTF-8 may not survive a non-ASCII profile path. Reasoned from the format, not seen;
  `iconIssue` logs the case.
- A shell handle on `favicon.ico` could block the install's web swap. Not seen; a reinstall with the shortcut
  in place swapped without trouble.

## Disputed
- A source hash to catch `favicon.ico` drifting from its SVGs: the icon rarely changes, so the check costs
  more than a miss.
- Sampling the exported PNG for the mark's pixels in e2e: the inlined src is asserted, and the export was
  checked by eye.
