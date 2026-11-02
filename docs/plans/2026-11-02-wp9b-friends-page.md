# WP9b: the Friends page

## Context
WP9b is the last v1 work package (`docs/plans/2026-10-16-v1-roadmap.md` § WP9). WP9a
(`docs/plans/2026-11-02-wp9a-friends-data.md`, committed `61f1c6c`) shipped the friends tables,
suggestions, the "with teammate" filter, remark triggers and the shared `Tile`. WP9b adds the page
itself, built to prototype verdict **C5** (`git show prototype/friends-page:prototypes/friends-page/friends-prototype.html`,
header comment): a landing of suggestion banners and pair cards, and a friend view with the recap
scorebug as header, then **On your team** (blue) and **On the other team** (orange) zones side by
side (stacked on phones). The roadmap's "Done when": adding a friend from a suggestion drives the
filter, both sides of the page and the friend remark triggers.

Binding decisions (roadmap, prototype verdict, user):
- Build with the recap's tiles and condensed italic type, not the prototype's. No fifth tile kind
  (BACKLOG drift item); sentence-case section headings above panels, as on Recap/Trends.
- Private is split by team size (Private 1v1–4v4, plus "Private · uneven") on this page only.
- "Who carries" and "your stats with them" sit under a team size × Online/Private switch (Private
  2v2/3v3 only, uneven left out) and compare against your matches without them at the same mode.
- Best/worst playlist counts online playlists only. Match by match: 10 a page, no totals.
- New tiles: time together, overtime, goals, biggest win. Long names truncate, full on hover.
- One friend = one PrimaryId; friend queries take a list of ids (trio-ready, post-v1).
- Removing keeps matches; the confirm says they leave the filter and the page; they go to never-suggest.
- **User, 2026-11-02 (this plan):**
  - No manual add. Friends come only from suggestions ("if we play with someone frequently, only
    then we care about with and against").
  - The never-suggest list is shown, with "Suggest again", as prototyped.
  - Online modes are standard soccar only: ranked and casual Duel/Doubles/Standard/Solo
    Standard/Quads, sized by playlist. Extras and LTMs are left out of both sides of the
    with/without comparison. This applies to the mode switch only. The records, tiles and
    by-playlist rows count every match with them except offline play: no friend can be in a bot
    game, and leaving it out keeps them consistent with the filters.
  - BACKLOG item "Trends offers opponent-only friends": Trends lists only friends who were on your
    team at least once. With no manual add this is nearly moot (every friend was a suggested
    teammate), but it's a one-line filter on a count the page needs anyway, and it covers a friend
    whose teammate matches were re-labelled by rejecting one of your ids.
- Q7 check holds: everything is a query over stored data (`match_players` has team, teams_seen,
  scoreboard per player; `matches` has mvp_key, overtime, scores, playlist).

Tier: Substantial (new page, new endpoints; ~1,200 lines with tests, one session like WP9a).

## Approach

### Shared pure logic: `src/shared/friend-stats.ts` (new, TDD)
Input is one row per match you played (`LobbyMatch`, from the reader below):
`guid, startedAt, endedAt, playlistId, overtime, result, scoreTeam0/1, myTeam, sizes: [n0, n1]`
(players per final team, bots included), `me: Line`, `myTeamTotals: { score, goals }`,
`mvp: "me" | "friend" | "mate" | null`, `youSwitched`, and
`friends: (Line & { id, side: "with" | "against", switched })[]` for the listed ids present.
`Line` = score, goals, assists, saves, shots, playerKey.
- **Which matches count:**
  - Every match you played, except offline ones (group `"offline"`). The records, tiles and
    by-playlist rows use all of them.
  - Modes use an explicit id allowlist in `friend-stats.ts`:
    - online `{2, 3, 4, 11, 12, 13}` (with a teammate, so duel is excluded);
    - private by group `"private"` (6 Private Match, 26 External Match), when the lobby is an even
      2v2 or 3v3.
  - Everything else is out of the modes: ranked extras (Hoops, Rumble, Dropshot, Snow Day, Ranked
    Heatseeker), LTMs, tournaments, and unmapped or null ids.
- `side`: "with" = on your team at any point (`wasOn`, as WP9a); "against" = on the other team and
  never on yours; neither (no team bits) = not listed.
- `playlistRow(m)`: online playlists by name; private (group "private") as `Private NvN` when both
  sizes equal N in 1–4, else `Private · uneven`. Order: by playlist id, private rows last by size.
- `modeOf(m)`: `"2" | "3" | "4"` for standard soccar (ids 2, 3, 4, 11, 12, 13 by playlist size;
  duel has no teammate), `"p2" | "p3"` for an even private 2v2/3v3, else null.
- `friendView(matches, id)` → the page's whole view model (both sides), so the client only renders:
  - **with**: record `{w, l, n}` (win % over decided, as `aggregate`), last played, by-playlist rows
    with W/L, tiles: current streak, best win streak, best/worst online playlist (≥5 matches, ≥2
    rows, else none), time together (Σ ended−started), overtime record (only if any). `modes[]`
    (only modes played, most-played online first as default): per mode `carry` (score, goals, MVPs
    as [you, them, rest] where rest = team total − you − them; matches where they or you switched
    teams are left out of carry, as the final-team totals don't fit them, and WP9a's
    `friend_switched_team` warning already logs them) and `compare` (per-match win %,
    score, goals, assists, saves, shots: yours with them, yours **without them** = your matches at
    that mode where they weren't on your team, the diff, theirs).
  - **against**: record, last played, by-playlist rows, tiles: current streak, MVPs you–them, goals
    you–them, biggest win (largest goal diff among wins; none without a win), overtime record;
    `matches[]` newest first: guid, sessionKey, startedAt, playlist row label, playlistId, result,
    your line, their line, MVP (you/them/null).
- `friendCard(matches, id)` → `{ with: {w,l,n}, against: {w,l,n}, lastPlayed }` for the landing.

### Reader (`src/server/query/read.ts`)
`readLobbies(friendIds: readonly string[]): LobbyMatch[]` — every match you played (picked by
`pickMe`, as `resultRows`), with three grouped queries under one predicate: per-team player counts
(`GROUP BY match_guid, team_num`), your-team totals (score, goals by final team), and the listed
friends' rows (`json_each` param, humans, not yours). `mvp` from `mvp_key` against your key, the
friend's, then the MVP player's team. `timed("readLobbies")`. Reuses `wasOn`, `pickMe`, `MINE`,
`myResult`.

### Pages (`src/server/api/pages.ts`) and writes
- `friends()` (existing `GET /api/friends`) answers `friendCardSchema = friendSchema.extend(...)`
  per friend: `lastSeenName`, `with`, `against`, `lastPlayed`, from one `readLobbies(allIds)` +
  `friendCard`. The shared `Friend` type (`readFriends`, `sessionDetail`'s `friendsPresent`)
  doesn't change. Trends and the landing both read it.
- `createPages` takes the logger (for `query/friend_detail`).
- `friendDetail(id)` → `FriendDetail | null` (null when the id isn't a friend): friend names +
  `friendView`, with session keys from the index (`sessionOf` map, as `friendSuggestions`).
- `neverSuggested()` → `{ players: { id, name }[] }`, name = last seen (same subquery as
  `readFriends`), by name.
- `friends.ts`: `suggestAgain(id)` deletes the never-suggest row; `not_found` when absent; logs
  `friends/suggest_again`. `FriendWrite`'s ok case drops `friends` (`{ ok: true }`, and `done()`
  goes): the routes answer `pages.friends()`, the card list, so the client cache takes it whole.

### API (`src/server/api/index.ts`, `src/shared/schemas/responses.ts`)
- `GET /api/friends/detail?id=` → `friendDetailResponse` or 404.
- `GET /api/friends/never-suggest` → `neverSuggestResponse`.
- `POST /api/friends/suggest-again?id=` → never-suggest list, 404 when not on it; needs the
  `X-RLTracker-Request` header like every POST.
- `friendsResponse` lists `friendCardSchema`s; `friendSchema`/`Friend` stay as they are.

### Web
- **Refactor first:** move the recap `Scorebug` markup and CSS (`Overview.tsx`/`.module.css`
  `.bug/.side/.mid/.right`) to `src/web/components/Scorebug.tsx` with `left`, `mid`, `right`
  slots and `label` (aria). Recap unchanged visually. `Tile` gains an optional `note`: the small
  muted line under the value, e.g. "together" or "Ranked Doubles · 22–17". Nothing else in its
  anatomy changes, and the value stays a plain string in the big type:
  - best/worst playlist: the value is the win %, and the playlist name goes in the note (a long
    name like "Ranked Solo Standard" never sits in 30px type);
  - MVPs and goals: the value is "3–1", with the note "you – Sam" (no blue/orange split in the
    value).
- Move `SaveStatus` from `pages/settings/parts.tsx` to `src/web/components/SaveStatus.tsx`
  (with its CSS). Settings imports it from there.
- Route `/friends` and `/friends/:id` (id encoded with `encodeURIComponent`) in `App.tsx`; a
  **Friends** tab in `Header` after Trends. This is the roadmap's "Friends link" (moved from WP8);
  no separate Settings link, as the tab is always visible.
- `queries.ts`: `useFriends` (now with cards), `useFriendDetail(id)` (`["friend", id]`),
  `useSuggestions` (`["friend-suggestions"]`), `useNeverSuggested` (`["never-suggest"]`).
  - Writes go through `useWholeWrite(["friends"], …, staleAfterTables)`. `staleAfterTables` is
    reused as it is (everything stale but settings, ids and seasons; friends join at read time, so
    any page can move), and its comment widens to cover friend writes.
  - Add and Never suggest also remove the id from the cached `["friend-suggestions"]` in
    `onSuccess`, before focus moves, so the next banner is picked from the new list.
  - `suggest-again` writes `["never-suggest"]` and stales suggestions.
  - New match events already stale every key but settings.
- `pages/friends/FriendsPage.tsx` (landing): h1 "Friends"; a banner per suggestion ("You've teamed
  up with **X** in N matches over M sessions" · Add friend · Never suggest); pair cards as links
  (name truncated with `title`, "seen as · platform" via `platformOf`, Together and Against
  records with a W/L bar, last played); empty state (no friends, no suggestions) with the rule
  text; a native `<details>` "Players you said never to suggest" with Suggest again per row.
- `pages/friends/FriendPage.tsx`: "← Friends" link; header row with name (h1), "seen as", platform,
  Set/Edit nickname (inline form) and Remove friend (inline two-step); `Scorebug` (TOGETHER w–l |
  NAME · win% · win% · WITH · AGAINST | w–l HEAD-TO-HEAD) and "Last together · last against";
  the two zones; links "Matches with X →" (`/recap?with=`) and "Trends with X →" (`/trends?with=`).
  - With zone: `Tiles` (streak, best streak, best/worst playlist, time together, overtime), by
    playlist list, then "Who carries · stats with them" with the two `aria-pressed` switch groups
    (team size; Online/Private, a combination not played disabled), carry bars with the even-share
    tick, and the compare table.
  - Against zone: `Tiles` (streak, MVPs, goals, biggest win, overtime), by playlist, match-by-match
    table (You / Them column groups, ★ MVP, no totals), 10 a page with ← Newer / Older →. Each row's
    date is a real link to `/recap/<session>/match/<guid>?filter=<playlistId>` (single-playlist
    filter, so a private match is in view).
  - A zone with no matches says so ("You haven't played against X yet.").
- `logic/friends.ts` (pure, TDD): page slicing, mode-switch options (sizes, online/private enabled,
  picked mode falls back to the default when the friend lacks it), carry percentages and the
  even-share tick, display formatting of a W/L record.
- Trends (`TrendsPage.tsx`): offer `offeredFriends(friends)` (new, in `logic/filter-options.ts`
  next to `teammateMissing`: friends with `with.n > 0`).
  - `with.n` counts every playlist (online or not, private too), so a friend you only played
    Hoops or private with is still offered. Trends' own playlist filter then decides what shows.
  - `teammateMissing` then resets an opponent-only friend to Anyone, as it does an unknown id.
  - Close the BACKLOG item.
- **The page's records differ from Recap and Trends, on purpose.** The Together record counts
  private matches, and Trends' "Everything" leaves them out. The by-playlist list shows the
  private rows, which accounts for the difference. Below the scorebug, a line reads "Private
  matches count here; Recap and Trends leave them out unless filtered to Private."
- Styles: `pages/friends/Friends.module.css` on the existing tokens (`--blue`/`--orange` for the
  zones, `--win`/`--loss` for W/L bars, `--up`/`--down` for diffs); tables reuse the recap Matches
  table look (shared rules moved to a module if more than a handful would be copied).

### Design contract
- **Job**: see how you do with and against the people you play with often; keep the list tidy.
- **Primary action**: open a friend. Secondary: add / never-suggest a suggestion, set a nickname,
  jump to Recap or Trends with them, open a match.
- **States**: loading; load error with Retry (the recap/Trends pattern); no friends and no
  suggestions; suggestions only; a friend with no with or no against matches; a friend with one
  mode only (no switch, the mode as text); an id that isn't a friend (removed, stale link) →
  empty state with a link to Friends; long names (32-char nickname, long gamertag); write failed.
- **Responsive**: 320 / 768 / 1024 / 1440; zones side by side ≥1024, stacked below; scorebug
  records scale down at ≤480; wide tables scroll inside their panel; no page scroll sideways.
- **Reject**: modal dialogs, toasts, counts in pickers, a global Save, a fifth tile kind.

### Interaction contract
| Trigger | What shows | Focus |
|---|---|---|
| Friends tab / Back / Forward / reload | the route's view; loading, then content | page's rule: focus that falls to the body goes to the h1 (as Trends' title) |
| Card click | `/friends/:id` | h1 (friend name) |
| ← Friends | landing | h1 |
| Add friend | banner leaves, card appears, status "Added X" (live region) | next banner's Add, else the h1 |
| Never suggest | banner leaves; never list gains them | next banner's Add, else the h1 |
| Suggest again | row leaves the list, banner returns if they still qualify | the `<details>` summary; the h1 when that was the last row (the `<details>` goes) |
| Set/Edit nickname | inline input (prefilled, placeholder = seen name), Save / Cancel | input; after Save or Cancel/Esc, the edit link; "✓ Saved" via `SaveStatus` |
| Nickname save fails | "Couldn't save · Retry" | stays in the form |
| Remove friend | inline "Remove X? Your matches stay; they leave the filter and this page." Remove · Keep | Remove; Keep/Esc → the trigger |
| Remove succeeds | navigate (replace) to landing, status "Removed X" | h1 |
| Remove fails | inline failure text, confirm stays | Remove |
| Team size / Online-Private | carry + compare for that mode (client-side, no load) | the pressed button |
| ← Newer / Older → | next page of 10 | the button; at the first/last page it's `aria-disabled`, focus stays |
| Match date link | the match page | the match page's own rule |
| Matches/Trends with X → | `/recap?with=` / `/trends?with=` | that page's rule |
| Detail load fails / refetch after a new match fails | error state with Retry / keeps the shown data | Retry / unchanged |

Mode and page are component state (reset per friend), not URL state: neither is worth a link.

### Logging
- Server: `friends/suggest_again` (id, result) and the existing `friends/refused`; `timed("readLobbies")`
  answers what the page costs as history grows; `pages.friendDetail` logs `query/friend_detail`
  (`id`, `with`, `against`, `modes`) so a page that looks wrong can be checked against counts.
- Client: `console.warn("[rlt] friends/save_failed", { action, code })` on every failed write (as
  ids/settings); `console.debug("[rlt] friends/focus", …)` where focus is moved by code.
- Unseen shapes, all cheap and obvious, so no Watch item:
  - A private lobby with more than 4 a side shows as uneven, with no new handling.
  - Private sizes count every player row per final team. Someone who joined mid-match, or left,
    can make an even lobby "uneven"; it then drops out of the private modes and is still counted in
    the records.
  - A friend row with no team bits isn't listed on either side.

## Tests (TDD per `tdd-live-code-carveout`)
- Vitest, red first:
  - `friend-stats`: the inclusion rules (Exhibition is dropped; Ranked Hoops, an LTM and a null
    playlist count in the records but not the modes; External Match is a private mode); carry
    leaves out switched matches;
    side (with, against, switched friend counts as with, no team bits → neither);
    private split 1v1–4v4 and uneven; best/worst online only, ≥5, ≥2 rows; streaks skip no-result;
    time together; overtime; carry rest = team − you − them; compare "without" excludes matches
    with them and other modes, includes ones where they were an opponent; modes only standard soccar
    + even private 2v2/3v3, default most-played online; biggest win; MVP you/them/mate; card counts.
  - `read.test.ts` `readLobbies`: team counts with a bot, your-team totals, friend side, a list of
    two ids, spectated matches skipped.
  - `friends.test.ts`: `suggestAgain` (deletes, 404 when absent, suggestion returns).
  - `pages.test.ts`: `friends()` cards; `friendDetail` null for a non-friend, session keys;
    `neverSuggested` names.
  - `api.test.ts`: detail 400/404/200, never-suggest GET, suggest-again header/404/200, write
    routes answering the enriched list.
  - `logic/friends.ts`: paging, mode options and fallback, carry percentages.
  - `filter-options.ts`: `offeredFriends`, and `teammateMissing` resetting an opponent-only friend.
- Playwright `friends-page.spec.ts` on an extended `friends` seed (a suggestion candidate with 3
  matches over 2 sessions; with-matches in Ranked/Casual Doubles and Private 2v2; >10 against
  matches in Private 1v1 with an MVP each way and an overtime; an opponent-only friend inserted
  directly):
  - add from a suggestion → card, the recap filter offers them;
  - never suggest → the list; suggest again → banner back;
  - open a friend: scorebug records, both zones, mode switch changes the compare table, pager,
    a match link opens the match page;
  - nickname set/clear; remove → landing, gone from the Trends filter;
  - Trends doesn't offer the opponent-only friend;
  - focus per the interaction contract: Add with two suggestions moves to the next banner's Add,
    then remove, the pager and the nickname form;
  - 320px no horizontal scroll; axe in the three themes.
  Existing recap specs pass after the Scorebug move.

## Steps
1. Save this plan as `docs/plans/2026-11-02-wp9b-friends-page.md`; roadmap WP9 status → WP9b in progress.
2. Scorebug extraction + `Tile` `note` (refactor); recap Vitest + Playwright green.
3. `friend-stats.ts` (red → green).
4. `readLobbies`, `suggestAgain` (red → green).
5. Pages + API + schemas (red → green). *Midpoint: offer `/compact` with a resume prompt.*
6. Web: queries/write hooks/invalidation, routes, header tab, landing, friend page, `logic/friends.ts`.
7. Trends friend list; BACKLOG item closed.
8. e2e seed + spec; full suite, lint, typecheck, build; 320px; then real browser per
   `ui-implementation-guidelines` (keyboard pass, breakpoints, states, console).
9. Stop for `/compact`, then `independent-review-pass`; docs (roadmap status, BACKLOG, commit
   body); ask before committing.

## Verification
- `bun run test`, `bun run lint`, `bun run typecheck`, `bun run build`, `bun run e2e`.
- Real data on a read-only `VACUUM INTO` copy of the deployed DB, a new server on a spare port (as
  WP9a): add a suggestion from the page, check the card records against the recap with that
  friend, open the friend, compare the with-record's non-private by-playlist rows to Trends
  `?with=` all-time W/L, step the mode
  switch, page the head-to-head (if any), open a match from it, set a nickname, remove and re-add
  via Suggest again. No console errors; keyboard-only pass; 320/768/1024/1440.
- Left for the user after deploy: the duo remark line on ↻ and the share card "· with <nick>"
  (WP9a's leftovers), plus the subjective look of the page.

## Verification run
- `bun run test` 1113 passed; `typecheck` 0 errors; `lint` clean; `vite build` ok; `bun run e2e`
  75 passed (friends-page.spec 8, incl. 320px and axe in three themes; friends.spec 7).
- e2e found and fixed: two spec files on one "friends" stack leaked a nickname write (the page spec
  takes its own seed name, `friends-page`); after Remove, the removed friend's page was refetched
  (a 404 in the console), so `useRemoveFriend` no longer stales that `["friend", id]`; axe contrast
  on the carry bar's "You" text and the match table's You/Them headings in slate.
- Real data, on a read-only `VACUUM INTO` copy of the deployed DB (168 matches), new server on a
  spare port: 3 suggestions; added HulkingPen12238 → card Together 47–49, Against 2–0; Trends
  `?with=` Everything 47W–49L and All ranked 35–33, matching the page's Doubles 12–16 + Ranked
  Doubles 35–33 rows; one mode (2v2), so no switch; head-to-head 2 matches (Honor Duel, Private
  1v1), match links open. Keyboard-only (scripted): card → h1, Set nickname → input, Save → Edit
  nickname, Remove → confirm's Remove → landing h1 "Removed Hulk", Suggest again (last row) → h1,
  banner back, re-added. 320/768/1024/1440: no sideways scroll, no console errors. Logged:
  `friends/added|nickname|removed|suggest_again`, `query/friend_detail` (with 96, against 2,
  modes ["2"]), `readLobbies` 168 rows in 3 ms.
- Found and fixed in the browser: the scorebug's Together record broke at its dash beside a long
  name ("47–" / "49"), now `nowrap`; the code-focused h1 drew a focus ring (now none, as Trends).

## Plan review
`plan-reviewer` (opus), 2026-11-02. All findings folded in:
1. High. Which matches count was unspecified. **Fixed:**
   - records, tiles and rows count every match except offline ones;
   - the modes use an explicit allowlist (online `{2,3,4,11,12,13}`, private group 6/26 when even
     2v2/3v3);
   - tests cover Exhibition, Ranked Hoops, an LTM, null and External Match.
2. Med. Trends `with.n` against the "ever on your team" rule. **Fixed** by (1): `with.n` counts
   every playlist, so a Hoops-only teammate is still offered.
3. Med. The verification expected the page and Trends to agree. **Fixed:**
   - the gap (private matches) is accepted and explained by a line on the page;
   - verification compares the non-private rows.
4. Med. Extending `friendSchema` would change the shared `Friend` type. **Fixed:** a separate
   `friendCardSchema`, and `FriendWrite` drops `friends`.
5. Med. Focus after Add/Never suggest was read from a stale list. **Fixed:** the id is removed from
   the suggestions cache in `onSuccess`; an e2e covers two suggestions.
6. Med. Carry could go negative after a team switch. **Fixed:** switched matches are left out of
   carry, with a test.
7. Low. `staleAfterFriends` duplicated `staleAfterTables`. **Fixed:** reuse it.
8. Low. The Trends reset had no test seam. **Fixed:** `offeredFriends` in `filter-options.ts`,
   with Vitest.
9. Low. **Fixed:**
   - `createPages` takes the logger;
   - `SaveStatus` moves to components;
   - tile values stay plain strings, with long playlist names in the note;
   - focus falls back to the h1 when the last never-suggest row goes.
10. Low. Private sizing with mid-match joiners. **Accepted** and stated under Unseen shapes.

## Review log
Diff re-classified at review: 1,561 non-test lines changed, so Substantial. Passes: `/code-review high`,
`arch-reviewer` (opus), `security-reviewer`, `/simplify`.

### Round 1 (snapshot `ad51ed20`)
- **security-reviewer**: no findings. Checked myself that `suggest-again` needs the request header:
  an API test expects 403 without it.
- **`/code-review high`**:
  1. After Add or Never suggest, focus went to the first banner's Add, not the next one. **[Fixed]**
     It now goes to the Add at the same place, or the one before when the last banner went. The e2e
     seed has a third suggestion (Max), and the spec adds the middle one.
  2. A failed background refetch replaced the landing with the error state. **[Fixed]** Guarded
     with `&& !data`, as on the friend page.
  3. A removed friend's page stayed cached, so reaching it again in the app showed them. **[Fixed]**
     The remove write drops `["friend", id]`, and the stale predicate no longer takes the variables.
     The e2e goes back to the page in-app and expects the not-a-friend state.
  4. Private sizes count leavers and joiners. **[Verified, no fix needed]**: accepted in plan review
     item 10 and under Unseen shapes.
  5. Each friend write refetched the key it had just filled. **[Fixed]** `useWholeWrite` never
     stales its own key.
  6. `GET /api/friends` builds cards on every call. **[Fixed]** in part: it returns early when there
     are no friends. The rest is **[Verified, no fix needed]**: 168 matches cost 3 ms, and
     `timed("readLobbies")` logs the cost if history grows.
  7. A nickname save could be sent twice. **[Fixed]** `isPending` guard.
  8. The Matches/Trends links showed for an opponent-only friend. **[Fixed]** Shown only when
     they've been on your team.
  9. A failed never-suggest load hid the section silently. **[Fixed]** Inline error with Retry.
  10. The mode enum was written twice, and SaveStatus's Retry lost 13px. **[Fixed]**
      `z.enum(MODE_ORDER)`, font size restored.
- **arch-reviewer (opus)**: one risk (= code-review 2) and 14 nits.
  - Fixed: best/worst read private-ness from the label (now `isPrivate`); a misplaced comment and
    a reduce in `friendCard` (now `maxOrNull`); the dead `.records .side b` at 640px;
    `warnFailed` moved to `parts.tsx`; `pickMode`'s redundant fallback; `sizeOf` exported and
    reused. The rest overlap code-review 2, 5, 7, 8, 9 and 10.
  - **[Verified, no fix needed]**, recorded here as plan deviations:
    - `readLobbies` reads all player rows and filters in JS, not three grouped queries: one
      pass is simpler, and the cost is logged.
    - `readLastNames` is its own query: it answers several ids at once, which `readFriends`'
      subquery doesn't.
    - `LobbyMatch` carries `goalDiff`, `mvpKey` and `mvpOnMyTeam` rather than a per-friend `mvp`,
      since one match can hold several listed friends.
    - Scorebug records scale at 640 and 420px, not 480: those are the recap scorebug's own
      breakpoints.
- **`/simplify`** (reuse, simplification, efficiency, altitude):
  - Fixed: `streaks`, `sum` and `maxOrNull` reused from `aggregate.ts`; best/worst destructured once;
    the Nickname and Remove open/close focus effects merged into `useOpenFocus` in `parts.tsx`.
  - Skipped:
    - Zod-inferred `FriendView` types: the pure module would then depend on zod.
    - Merging the landing's write and Suggest again handlers: they differ in messages and focus.
    - A one-line friend write helper in `queries.ts`: the five hooks read clearly as they are.
    - `SEED_OF` map in the e2e stack: two entries.
    - Scorebug sizing by content: low value.
    - Narrower invalidation for Never suggest and Suggest again: coarse invalidation is the
      app's rule, and the cost is milliseconds.
    - Per-friend SQL filter and memoised lobbies: cost not measured as a problem.
    - Moving dropSuggestion's focus concern into the list: plan review item 5 chose the cache edit.
- After fixes: `bun run test` 1113 passed; typecheck and lint clean; full e2e 75 passed, then
  `friends-page.spec` 8 passed after the last spec fix. Both new e2e checks failed against the
  pre-fix build.

### Round 2 (delta since `ad51ed20`)
- Passes: `arch-reviewer` (sonnet), `/code-review low`, `security-reviewer`.
- `/code-review low` and security found nothing. Arch found no bugs, and two comment nits: a
  long header line and a terse focus index. **[Fixed]**, as wording only, so the round still
  counts as clean.
- Arch asked whether dropping `["friend", id]` while the page still observes it is safe. **[Verified,
  no fix needed]**: the caller navigates away straight after, and the e2e covers the return.
- Done: a round with no new finding.
