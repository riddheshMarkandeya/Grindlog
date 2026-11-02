# WP9a: Friends data, API, "with teammate" filter, remark triggers, share card label, shared Tile

## Context
WP9 (Friends) is the last v1 work package (`docs/plans/2026-10-16-v1-roadmap.md` § WP9). The user
split it on 2026-10-28: **WP9a** is the data, API, "with teammate" filter, friend remark triggers
and share card label, with the shared Tile pulled out of the recap first; **WP9b** is the Friends
page (prototype verdict C5, `prototype/friends-page`). Everything is a query over stored data
(`match_players` already has `primary_id`, `is_bot`, `team_num`, `teams_seen` per player), so the
Q7 check ("stop if it grows past queries over stored data") holds: no new capture.

Binding decisions (roadmap, map "Friends" and "Recap layout", grill round 3, user 2026-10-28):
- One friend = one `PrimaryId`, an optional nickname, and otherwise the last name seen. The
  nickname shows everywhere the friend appears (filter, share card label, remark lines).
- Suggestions: humans who were your teammate in ≥3 matches across ≥2 sessions; bots never.
- "With them" = on your team at any point in the match. A friend switching teams mid-match is
  flagged, with a Watch item.
- Soloqueue = no added friend on your team; a friend on the other team doesn't count.
- Filter: Anyone, Soloqueue, then friends, no counts. On the recap: only the friends in the
  session; resets to Anyone when the friend isn't there; disabled when no friend is.
- Removing a friend keeps the matches; the friend leaves the filter and goes to never-suggest.
- The friend queries take a list of friend ids (ready for trio stats, post-v1).
- Tile: only the tile moves to `src/web/components`; the rest of the drift item stays in BACKLOG.
- Remark trigger conditions (`2026-10-16-recap-remarks-copy.md`): duo good = a friend, ≥3
  matches together, w ≥ l; duo bad = w < l; soloqueue night = no friend on your team all
  session, ≥4 matches. Don't quote the joke lines in chat.

Tier: Substantial (one WP, about 1,200 lines with tests: one session, like WP7a/7b).
WP9a ships no add-friend UI (that's WP9b), so the real-DB check adds a friend with `curl`.

## Approach

### Teammate filter: a second, separate filter
`TeammateFilter = "anyone" | "solo" | { friends: string[] }` in a new
`src/shared/teammate-filter.ts`, next to `PlaylistFilter`, not folded into it. The two are
independent controls, and `PlaylistFilter` already feeds settings, group labels and filenames.
- `withTeammate(matchFriends: readonly string[], f)`: anyone → true; solo → `matchFriends` is
  empty; friends → every listed id is in `matchFriends`. The list form satisfies "the friend
  queries take a list". The UI and param only ever send one id.
- `teammateValue(f)` / `teammateParam` (Zod): `?with=` is left out for anyone, or is `solo`, or is
  a PrimaryId (string, 1–100 chars, at least two `|`). An unknown id just matches nothing; the
  client decides what the dropdown offers.
- Server functions keep `filter: PlaylistFilter` and take `teammate: TeammateFilter = "anyone"`
  as a trailing parameter, so existing callers and tests don't change.

### Data: migration 5 and the reader
- Append `trackerMigrations[5]` (migration 6; `[4]` is already remarks) in
  `src/server/db/migrations.ts`: `friends (primary_id TEXT PRIMARY KEY, nickname TEXT, added_at
  INTEGER NOT NULL)` and `never_suggest (primary_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL)`.
  `migrate.test.ts` covers a version-5 DB moving forward.
- `src/server/query/read.ts`:
  - `MatchResult` and `MyMatch` (`src/shared/aggregate.ts`, plus `myMatchSchema` in
    `responses.ts`) gain `friends: string[]`: your friends on your team at any point
    (`teams_seen & (1 << your team_num)`), humans only, never one of your ids. It comes from one
    extra query per read: `match_players JOIN friends`, under the same `where(range)`, grouped by
    guid. Because the join reads `friends` at query time, adding or removing a friend
    re-labels every match, the same way `my_ids` does. When you have no team (`team_num` is null)
    you have no friends in that match. The bit test runs in SQL, where `1 << NULL` matches nothing,
    and a test covers it.
  - A friend with `teams_seen = 3` logs `query/friend_switched_team` once per match (a Set, like
    `twoYousReported`). It still counts as "with". If your own `teams_seen` is 3, "with" is judged
    by your final team, and the same line logs `you: true`. One BACKLOG Watch item covers both
    cases.
  - `readTeammates()`: for suggestions, rows of `(guid, primary_id, name, started_at)` for every
    human on your team who isn't you. `readFriends()`: friends with their nickname and their last
    name seen (from their latest match).
- `src/server/friends.ts` (new, modelled on `seasons.ts` / `ids.ts`). Each write runs in
  `tracker.transaction`, returns the full list and logs `friends/<event>`:
  - `add(id, nickname?)` takes a human seen in any match, as teammate or opponent, since WP9b's
    Against tab needs opponents too. It refuses a bot or one of your ids (404), and an existing
    friend (409). It clears the id's never-suggest row.
  - `setNickname(id, nickname)`: 404 when the id isn't a friend.
  - `remove(id)`: 404 when the id isn't a friend. It deletes the friend and runs
    `INSERT OR IGNORE` into never-suggest, so remove, re-add, remove doesn't fail.
  - `neverSuggest(id)`: a current friend gets 409; otherwise `INSERT OR IGNORE`.
  - Nicknames are trimmed, an empty one becomes null, and the cap is 32 characters (the share
    card's longest stress name).

### Pages (`src/server/api/pages.ts`)
- `yours(filter, teammate)` and `rowsOf(s, filter, teammate)` apply both filters. Everything built
  on them (summaries, list, months, current, latest, detail, period, rolling, played days) follows
  the teammate filter. So ‹ › on the recap steps between sessions with that friend, as it does
  under a playlist filter.
  - The recap's 30-day baseline follows the teammate filter, as it already follows the playlist
    filter. So "with Sam" compares against your recent matches with Sam, and a thin baseline
    already has its fallback.
  - `playedDays`' `firstDay` and `totalMatches` stay independent of the teammate filter, as they
    are now independent of the playlist filter.
- `SessionDetail` gains `friendsPresent: { id, name }[]`: friends on your team in the session's
  played matches under the playlist filter only (not the teammate filter). The recap dropdown
  offers these, and the soloqueue trigger reads them. Basing it on the playlist filter means a
  listed friend never filters to nothing.
- `friendSuggestions()`: from `readTeammates()` and the session index; keeps humans with ≥3
  matches in ≥2 sessions who are not friends, not on the never-suggest list and not yours. Name =
  last seen. Sorted by matches, most first.
- Display name everywhere = nickname ?? last name seen.

### API (`src/server/api/index.ts`, `src/shared/schemas/params.ts`, `tables.ts`)
- `with` is added to `filterOnly`, `sessionsParams`, `monthsParams`, `periodParams` and
  `playedDaysParams`, and to the remarks GET and reroll.
- `GET /api/friends` (list), `GET /api/friends/suggestions`, and `POST /api/friends`,
  `/api/friends/nickname`, `/api/friends/remove`, `/api/friends/never-suggest`. The id goes in the
  query string, like the existing POSTs, which also require the `X-RLTracker-Request: 1` header.
  The status codes are as listed under `friends.ts`, plus 400 for a bad param.

### Remarks
- Store key (`src/server/remarks/store.ts`): `filterValue(filter)` for anyone (existing picks
  keep their key), plus `|solo` or `|with:<id>` otherwise. No migration.
- `triggers.ts`: `SessionFacts` gains `friendsPresent`, with names. Duo friends are always among
  them, so no separate name lookup is needed.
  - Duo: over the facts' matches, pick the friend with the most matches together (≥3). A tie goes
    to the friend the teammate filter names, then to the lower display name, so the pick is
    stable. That friend fires `duo_good` (w ≥ l) or
    `duo_bad`, with `{ w, l, friend }`. Only one duo fires per session. Bad also needs ≥3, which
    the copy doc implies but doesn't say.
  - Soloqueue: `friendsPresent` is empty and there are ≥4 played matches under the filter.
  - Remove `inert` from `duo_good`, `duo_bad` and `soloqueue` in `copy.ts`.
- `RemarkValues` gains `friend?: string`. The response schema's `values` becomes
  `number | string`. `fillRemark` (`src/web/logic/remarks.ts`) inserts strings as they are. The
  name is resolved at read time, so a nickname change shows on revisit. Values are already
  recomputed from `fired` on every read.

### Web
- `src/web/components/Tile.tsx` + `Tile.module.css`: moved out of the recap's `.tiles` list
  (`Overview.tsx`, `Overview.module.css`). Props `{ label, value, icon?, vs? }`, plus a `Tiles`
  `<ul>`. `vs` is `{ dir, text }`, and the caller writes the text ("avg 40%"), so WP9b can use it
  for its with/without comparison. The markup and look don't change. Done first, as a pure
  refactor.
- `src/web/components/TeammateFilter.tsx`: a native `<select>` (Anyone, Soloqueue, friends by
  display name, no counts) beside `PlaylistFilter`.
- PrimaryIds contain `|`. Every request and every path that carries `with` encodes it with
  `URLSearchParams` or `encodeURIComponent`.
- Recap (`RecapPage.tsx`, `logic/recap.ts` `recapPath`):
  - `?with=` URL state, written only when it isn't anyone. `recapPath`'s new parameter reaches
    every caller (SessionPicker, Matches, MatchView, Overview and others; 23 calls in 8 files).
  - Options come from `detail.friendsPresent`, and the select is disabled when that is empty.
  - When the URL names a friend not in the session, or `solo` in a session with no friend, it is
    replaced with Anyone (`navigate(..., { replace: true })`). The index page does the same when
    `latest` finds no session under the teammate filter.
  - Focus (UI default): `seen` gains `with`, and the select gets a ref. Changing it, or the
    reset, returns focus to the teammate select, not the picker.
- Trends (`TrendsPage.tsx`, `logic/trends.ts` `parseTrends`/`patchTrends`):
  - `with` in the URL state. Options are every friend (`useFriends`, `["friends"]`), and the
    select is disabled when there are none.
  - Once friends load, an id that isn't a friend (or `solo` with no friends) is replaced with
    Anyone, as on the recap.
  - Focus follows the same rule as the recap.
  - `bucketHref` (`logic/trend-chart.ts`) carries `with` into its recap links.
- `queries.ts`: `with` goes in every page query key and request, plus `useFriends`. No write hooks
  (WP9b).
- Share card (`logic/share-card.ts`):
  - The label joins the playlist label (non-default) with "with <name>" or "Soloqueue", using
    " · ".
  - The filename gains `-with-<slug>` or `-solo`. A nickname that slugs to nothing (non-ASCII)
    gives `-with-friend`.

### Tests (TDD per `tdd-live-code-carveout`)
- Vitest, red first:
  - `withTeammate`: anyone, solo, one friend, a list.
  - The `friends` reader: on your team at any point, a friend on the other team, a bot, your own
    id, no team of yours, the switched-team flag firing once.
  - Suggestion edges: 2 matches / 3 in one session / 3 across two sessions, never-suggest, an
    existing friend, a bot.
  - `friends.ts`:
    - remove → never-suggest in one transaction;
    - remove, re-add, remove;
    - `add` refusals (bot, yours, existing friend);
    - `add` clearing never-suggest;
    - nickname trim, empty and cap.
  - `api.test.ts`: the friends routes' 400/404/409 and round trips, the header requirement, and
    `with` on the page routes.
  - `pages.test.ts`:
    - the teammate filter through list, detail, period and rolling;
    - soloqueue with a friend on the other team counts as solo;
    - `friendsPresent` ignores the teammate filter;
    - played days' `firstDay` stays the same.
  - Triggers:
    - duo good/bad at 3 matches, and 2 (below the minimum);
    - the tie-break, preferring the filtered friend;
    - soloqueue at 4 vs 3 matches.
  - Remark key back-compatibility.
  - `fillRemark` with `{friend}`.
  - Share label, and the filename with its non-ASCII fallback.
  - `recapPath`, `parseTrends`/`patchTrends` and `bucketHref` with an encoded `with`.
  - Param parsing.
- Playwright: a new `friends` seed (`test/e2e/stack.ts`, `fixtures.ts`): a session with a
  nicknamed friend in some matches and one without, plus a session with no friends. Spec:
  - the recap select filters and its options;
  - the select is disabled on the no-friend session;
  - a URL naming an absent friend resets to Anyone;
  - Trends lists the friend;
  - the share card shows "· with <nick>";
  - focus returns to the teammate select after a change.
  `share-stress.spec.ts` gains the longest label ("Ranked Doubles · with" plus a 32-character
  nickname). The existing recap specs still pass after the Tile move.

### Logging
- `friends/added|nickname|removed|never_suggest` record the id and the result, and answer who was
  added or removed, and when.
- `query/friend_switched_team` records guid and id, and answers whether teams_seen=3 happens for
  a friend.
- `timed("readTeammates")` covers suggestion cost. Remarks' existing `remark_picked` already logs
  `fired` and `filter`, which now carries the teammate part.

## Steps
1. Save this plan as `docs/plans/2026-11-02-wp9a-friends-data.md`; WP9 status → WP9a in progress.
2. Tile extraction (refactor); recap Vitest + Playwright green.
3. `teammate-filter.ts` + params (red → green).
4. Migration 6 (`trackerMigrations[5]`), reader `friends` field + `readTeammates`/`readFriends`, `friends.ts` (red → green).
5. Pages threading, `friendsPresent`, suggestions; API routes (red → green).
   *Midpoint: offer `/compact` with a resume prompt.*
6. Remarks: key, duo/soloqueue triggers, friend name in values and `fillRemark` (red → green).
7. Web: queries, TeammateFilter, Recap + Trends wiring, share card label/filename.
8. `friends` e2e seed + spec; full suite, lint, typecheck, build.
9. Stop for `/compact`, then `independent-review-pass`; then docs: BACKLOG (Watch item
   friend_switched_team; roadmap status), commit body; ask before committing.

## Verification
- `bun run test`, `bun run lint`, `bun run typecheck`, `bun run build`, `bunx playwright test`.
- Real DB: `curl "http://127.0.0.1:<port>/api/friends/suggestions"`, then pick an id, then
  `curl -X POST -H "X-RLTracker-Request: 1" "http://127.0.0.1:<port>/api/friends?id=<url-encoded id>&nickname=..."`.
  Then check that the
  recap and Trends filters list the friend and filter matches, that Soloqueue drops the matches
  with them, that a session with them shows a duo line on ↻ when it fits, and that the share
  card's label reads "· with <nick>".

## Plan review
`plan-reviewer` (opus), 2026-11-02. All findings folded in:
1. High. The migration index was wrong: `[4]` is remarks. **Fixed:** append `[5]` (migration 6),
   with a forward-migration test.
2. Med. The focus rule for the new select was missing. **Fixed:** `seen.with`, a ref, and an e2e
   check, on Recap and Trends.
3. Med. Trends didn't reset a `with` that isn't a friend. **Fixed:** it resets once `useFriends`
   loads.
4. Med. The `friends.ts` write rules were unspecified. **Fixed:**
   - who can be added: any human seen, opponents included;
   - 404/409 cases;
   - `INSERT OR IGNORE` into never-suggest;
   - `add` clears never-suggest;
   - nickname trim, empty and 32-character cap.
5. Med. The verification curls would have failed. **Fixed:** GET for suggestions, plus the
   `X-RLTracker-Request` header and URL encoding.
6. Med. Several test seams weren't named. **Fixed:** `api.test.ts`, `pages.test.ts`, `bucketHref`,
   and `recapPath`'s callers.
7. Low. No team, or your own team switch. **Fixed:** no team means no friends (SQL, tested); your
   own switch is logged and goes on the same Watch item.
8. Low. PrimaryIds contain `|`. **Fixed:** encoded in every request and path.
9. Low. **Fixed:**
   - the duo tie prefers the filtered friend;
   - `nameOf` is dropped in favour of `friendsPresent`;
   - the slug fallback is `-with-friend`;
   - the stress label case is added.
10. Low. Unstated scope choices. **Fixed:**
    - the baseline follows the teammate filter, stated as intended, matching the playlist filter;
    - played days' `firstDay`/`totalMatches` stay independent of it;
    - the index page resets when `latest` finds nothing;
    - Tile `vs` takes caller-written text.

## Deviations from the plan
- The "friend on your team" bit test runs in JS (`wasOn`), not SQL; a null team of yours still
  means no friends, and a test covers it.
- `readFriends` returns display names (nickname, else last name seen, else the id), listed by name.
- `friends.ts` writes return a `FriendWrite` union (`not_found` / `conflict`); the API answers 404,
  or 409 with `{error:"conflict"}`.
- Nickname rules (trim, empty to null, 32-character cap) live at the trust boundary in
  `friendNicknameParams`, not in `friends.ts`.
- **Revisited:** the `usePlayedDays` comment "A new filter's ticks wait for their load". A filter
  change showed the Loading state, which unmounted the Trends controls and lost focus (the playlist
  select too). Now it keeps the previous data with `days: []` until the new load; the focus e2e
  fails without it.
- The share-stress seed puts the friend in the baseline matches too, as the baseline follows the
  teammate filter and the stood-out callout needs it.
- Copy: "No matches under these filters…"; the match page's NotInView link reads "Show it with no
  filters" and clears both filters when the teammate filter is set.
- **Revisited (user, 2026-11-02):** Soloqueue no longer resets on a session with no friend, as
  paging under it lands on such sessions; the With select stays enabled while it's set.
- Duo triggers count decided matches only (≥3 wins plus losses), so 1–1 or 0–0 never fires.

## Review log
Tier by diff: Substantial (~780 non-test lines; design tier Substantial).

### Round 1 (snapshot `5b3a579`)
Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify` (4 angles).
- security: no findings.
- code-review:
  1. A teammate reset caused by a playlist change moved focus to the With select. [Fixed] A
     `resetByFilter` ref keeps focus on the playlist select; e2e, red with the fix off.
  2. Paging under Soloqueue reset it on a friendless session. [Fixed] per the user's call above.
  3. Trends' stale-`with` reset went through `patchTrends`, wiping `x`. [Fixed]
  4. Duo fired on undecided matches (1–1, 0–0). [Fixed] decided matches only; test.
  5. Reset effects depended on per-render filter objects. [Fixed] parsed filters memoized.
  6. `friendSuggestions` reads history twice. [Verified, no fix needed] personal-DB scale;
     `timed("readTeammates")` shows the cost if it grows.
  7. `MINE` copied in `friends.ts`. [Fixed] exported and reused.
  8. `Teammate.startedAt` unused. [Fixed] removed.
  9. `ShareTeammate` between imports. [Fixed]
  10. Trends offers friends who were only ever opponents, filtering to nothing. [Deferred →
      BACKLOG] to WP9b (user's call), which adds opponent friends.
- arch (opus): no bugs. Nits [Fixed]: friend order differs between pages (now by name in
  `readFriends`), `MINE` (as above), `add(true, …)`, Tile comment naming WP9b, `ShareTeammate`
  placement, the eslint-disable (gone with the memo), an unwrapped comment, TrendsPage import order.
  Nickname rules location [Verified, no fix needed] recorded under Deviations. Question on the
  comma list: [Verified, no fix needed] intended until trio stats; `teammateValue` says so.
- simplify: [Fixed] `rowsOf` builds its predicate once; the redundant `friendsPresent` sort and a
  stale "order added" comment. Skipped as plan decisions or not worth it at this scale: one
  `MatchFilter` object instead of two filters (plan: separate filters), `{friend}` instead of the
  list (plan: the queries take a list), server-side reset, a teammate column on remark picks,
  storing friends per match at ingest, a shared teamBit helper, shared param/reset hooks, the
  index.ts parse boilerplate, and single-pass duo counting.

### Round 2 (delta from `5b3a579`)
Passes: `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`.
- security, code-review: no findings.
- arch: plan deviations unrecorded [Verified, no fix needed] (the Deviations section above was
  being written meanwhile); `resetByFilter` could outlive its reset when focus was elsewhere
  [Fixed] (read and cleared on the load whose teammate changed, before the focus check); the
  `teammateValue` doc described future use [Fixed]; a redundant comment on `readFriends`' sort
  [Fixed]; `add(d !== null, …)` readability [Disputed] (keeps `add` uniform, as round 1 asked);
  friends endpoint now in name order [Verified, no fix needed] (no caller relied on added order).

### Round 3 (delta)
Passes: `/code-review low`, `arch-reviewer` (sonnet). Nits only, no new finding: the flag could
be recomputed if the reset effect re-ran before its navigation landed [Verified, no fix needed]
(its deps are memoized, so it re-runs only on a real change). Review closed.

## Verification run
- `bun run test` 1085 passed; `bun run typecheck` 0 errors; `bun run lint` clean;
  `bun run e2e` 67 passed (friends.spec 7, incl. 320px and axe in three themes).
- Real data, on a read-only `VACUUM INTO` copy of the deployed DB (168 matches), new server on a
  spare port: migration 5 → 6 with its pre-migration backup; `/api/friends/suggestions` gave 3
  (96/8, 44/3, 33/2 matches/sessions); adding one with a nickname worked, a second add 409, no header
  403, an unseen id 404, each logged under `friends`; the suggestion left the list. In Chrome: the
  recap's With listed the nickname, filtered (Soloqueue → none, as every match had them), and
  arrowing the select kept focus; Trends listed them and filtered (68 ranked matches); no console
  errors. No `friend_switched_team` line on the real data.
- Left for the user after deploy: a duo line on ↻ and the share card's "· with <nick>" on the real
  DB (both covered by unit and e2e tests).
