# Grindlog: public release map

## Destination
A public Reddit release that strangers can trust: seasons arrive on their own, the app says its own name, Steam
installs are checked, there is a landing page to link to, and the post answers the obvious questions up front.

## Notes
- Follows the friends release map (`docs/plans/2026-11-05-friends-release-map.md`). The order was agreed with the
  user on 2026-11-18.
- Take the first step still open. When one finishes, update its status here.
- FAQ line for SmartScreen: "Windows warns on the first install only, because the app isn't code-signed."
- Account profiles wait on whether anyone actually plays on alts; that's why they come after the release.

## Steps
| # | Step | Status | Plan or next action |
|---|---|---|---|
| 1 | Seasons from a repo season file | Built and reviewed; to push, then release 0.1.6 | S25 starts around 2026-12-09, so the sync has to ship in a release (0.1.6) before then. Plan: `docs/plans/2026-11-18-season-file.md`. |
| 2 | Toast app name | Open | Toasts say "Windows PowerShell"; send them as Grindlog (BACKLOG item). |
| 3 | Steam check | Open | BACKLOG Watch list "the first Steam user": a Steam friend, or a self-test. |
| 4 | Landing page on GitHub Pages | Open | One static page: download → releases/latest, What's new from the GitHub releases API with a plain-link fallback. `/prototype` 2–3 looks, then build; a few `/grill-me` questions at most. |
| 5 | Reddit post | Open | `/research` the subreddit's self-promotion rules, then draft: pitch, GIF/screens, FAQ (official Stats API with no injection or memory reading, data stays local, Windows only, SmartScreen, where to report bugs) plus GitHub issue templates. |
| 6 | Public release | Open | |
| 7 | Account profiles | Open | Header dropdown: all accounts, or one. Substantial: `/grill-me` → plan, maybe `/wayfinder`. |
| 8 | Controls drift and the rest of the polish | Open | Folded in from the friends map's step 6: controls drift, themes, colour pairs, the "What changed" card, a guided tour if needed (BACKLOG items). |
| 9 | Code signing | Open | Once there are public downloads: SignPath wants a track record, and Azure's option is US/Canada only. |
