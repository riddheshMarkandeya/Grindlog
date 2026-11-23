# Grindlog: public release map

## Destination
A public Reddit release that strangers can trust: seasons arrive on their own, the app says its own name, Steam
installs are checked, there is a landing page to link to, and the post answers the obvious questions up front.

## Notes
- Follows the friends release map (`docs/plans/2026-11-05-friends-release-map.md`). The order was agreed with the
  user on 2026-11-18.
- Take the first step still open. When one finishes, update its status here.
- 2026-11-22: no step is open; 8 and 9 moved to BACKLOG. New work comes from BACKLOG until a new map is agreed.
- 2026-11-23: the analytics map (`docs/plans/2026-11-23-analytics-map.md`) was agreed and follows this one.
- FAQ line for SmartScreen: "Windows warns on the first install only, because the app isn't code-signed."
- Account profiles wait on whether anyone actually plays on alts; that's why they come after the release.

## Steps
| # | Step | Status | Plan or next action |
|---|---|---|---|
| 1 | Seasons from a repo season file | Pushed and proved against the real URL (fa34a48); ships with the next release | S25 starts around 2026-12-09; if no release ships before then, installs add S25 by hand. Plan: `docs/plans/2026-11-18-season-file.md`. |
| 2 | Toast app name | Done; ships with the next release | Prod's PowerShell toasts go out under `Grindlog.Grindlog`, set on the installer's shortcut. Proved on a local 0.1.5 build installed over prod. Record: WP7 plan Results (the "Windows PowerShell" finding). |
| 3 | Steam check | Deferred 2026-11-18: no Steam user to test with; the setup card's by-hand ini steps cover Steam | BACKLOG Watch item: fit to the first Steam user's `user_missing` log. |
| 4 | Landing page on GitHub Pages | Live 2026-11-19 (da22bb5); indexed by Google | https://riddheshmarkandeya.github.io/Grindlog/ from `site/` via `.github/workflows/pages.yml`; screens from `bun run screens-data` + `bun run site:screens`. PageSpeed 2026-11-19: mobile 99 (LCP 2.1 s), desktop 100, all other categories 100. Done: Search Console (file verification, sitemap, indexing), repo About and social preview, Bing import. Next (user): around 2026-11-26, GSC Pages and Performance; adjust title or description if the queries differ. WebP/srcset screenshots declined 2026-11-19 (only ~300 KB on mobile, scores already 99–100). |
| 5 | Public release | Done: v0.1.6 published 2026-11-21 (9b39b59), signed | Ships steps 1–2 (seasons from the repo, the Grindlog toast name), and the sharp exe and tray icons (added 2026-11-19; plan: `docs/plans/2026-11-19-sharp-icons.md`). Moved ahead of the Reddit post on 2026-11-19 so the post links a release that has them. |
| 6 | Reddit post | Done 2026-11-20: posted on r/RocketLeague; GitHub issue templates added (3a35ae6) | `/research` the subreddit's self-promotion rules, then draft: pitch, GIF/screens, FAQ (official Stats API with no injection or memory reading, data stays local, Windows only, SmartScreen, where to report bugs) plus GitHub issue templates. |
| 7 | Account profiles | Done 2026-11-22; ships with the next release | Header dropdown: all accounts, or one confirmed id. Plan: `docs/plans/2026-11-22-account-profiles.md`. |
| 8 | Controls drift and the rest of the polish | Deferred 2026-11-22 to BACKLOG (user): controls drift is a recurring check of the current UI, not a one-off step | The "(from public release map step 8)" BACKLOG items: controls drift, the Trends data colour, themes, colour pairs, playful touches, the "What changed" card. |
| 9 | Code signing | Deferred 2026-11-22 to BACKLOG (user): the Reddit post drew no traction (0 comments; v0.1.6 had 4 installer downloads on 2026-11-22), so there is no track record for SignPath yet | Around 2026-12-22, check the release download counts; start only if public downloads have picked up. Azure's option is US/Canada only. |
