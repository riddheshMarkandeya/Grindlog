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
| 1 | Seasons from a repo season file | Pushed and proved against the real URL (fa34a48); ships with the next release | S25 starts around 2026-12-09; if no release ships before then, installs add S25 by hand. Plan: `docs/plans/2026-11-18-season-file.md`. |
| 2 | Toast app name | Done; ships with the next release | Prod's PowerShell toasts go out under `Grindlog.Grindlog`, set on the installer's shortcut. Proved on a local 0.1.5 build installed over prod. Record: WP7 plan Results (the "Windows PowerShell" finding). |
| 3 | Steam check | Deferred 2026-11-18: no Steam user to test with; the setup card's by-hand ini steps cover Steam | BACKLOG Watch item: fit to the first Steam user's `user_missing` log. |
| 4 | Landing page on GitHub Pages | Built 2026-11-19, not yet pushed | `site/`, `.github/workflows/pages.yml`, screens from `bun run screens-data` + `bun run site:screens`. Next (user): Settings → Pages → Source "GitHub Actions", push, then the SEO checklist: (1) Search Console URL-prefix property for the Pages URL, HTML-tag verification (send the tag; it goes in `site/index.html`), submit `sitemap.xml`, request indexing; (2) Bing Webmaster "Import from GSC"; (3) repo About: website, description, topics, social preview `site/og.png`; (4) links in: README (done) and the Reddit post; (5) a week on, check GSC Pages and Performance and adjust title/description. |
| 5 | Reddit post | Open | `/research` the subreddit's self-promotion rules, then draft: pitch, GIF/screens, FAQ (official Stats API with no injection or memory reading, data stays local, Windows only, SmartScreen, where to report bugs) plus GitHub issue templates. |
| 6 | Public release | Open | |
| 7 | Account profiles | Open | Header dropdown: all accounts, or one. Substantial: `/grill-me` → plan, maybe `/wayfinder`. |
| 8 | Controls drift and the rest of the polish | Open | Folded in from the friends map's step 6: controls drift, themes, colour pairs, the "What changed" card, a guided tour if needed (BACKLOG items). |
| 9 | Code signing | Open | Once there are public downloads: SignPath wants a track record, and Azure's option is US/Canada only. |
