# New seasons from a season file in the repo

Date: 2026-11-18

## Context
The Stats API carries no season, so every new season was added by hand in Settings → Seasons. S25 starts around
2026-12-09, and friends shouldn't each have to add it.

## Decision
Every install fetches `seasons.json` from the repo's `master` branch (`SEASONS_FILE_URL`, raw.githubusercontent.com)
once a day, 60 s after start, and applies it to the seasons table. On by default, with a Settings switch
("Add new seasons automatically"). The user always wins: a row the user edited stops following the file, a deleted
file season is remembered and never re-added, and a name or start another row already has is left to that row. A row
the file created and nobody changed moves when the file corrects its date. The sync never deletes.

## Why
- **Repo file (chosen):** a new season or a date fix is a one-line commit with no release, and the only new outbound
  request goes to the same GitHub the updater already talks to.
- **Scraping ggseason.com (rejected):** a third party's HTML behind Cloudflare, so it could break silently or start
  blocking, and its table lists a season only after it launches.
- **A migration per season in each release (rejected):** no outbound request, but every season would need a release
  shipped and installed before it starts, and a wrong date would need another one.
- The URL is baked into each release, so the file must stay at `seasons.json` on `master`. Moving it breaks the sync
  for every install older than the move.

## Files touched
`seasons.json`, `src/server/seasons-file.ts`, `src/server/seasons.ts` (`sync`, edit/remove), tracker migration 9
(`file_name`, `file_start`, `seasons_dismissed`), `src/server/main.ts`, `autoSeasons` setting, the
`seasons_changed` event, Settings → Seasons, README Privacy.

## Verification
See the plan's Results and Review log.

## Related
- Plan: `docs/plans/2026-11-18-season-file.md`
- Map: `docs/plans/2026-11-18-public-release-map.md` step 1
