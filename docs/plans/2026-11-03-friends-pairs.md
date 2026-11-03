# Friends pairs: trio "with" / duo "against" — build plan (parts a and b)

Status: done, deployed 2026-11-03 (part a `3dd58a3`, part b `0e66d11`). Left for the user: a
filled pair Against zone and "Show N more" with real suggestions, which no real data reaches yet.

## Context
BACKLOG post-v1 item: two friends both on your team ("with A and B"), or both on the other team
("against A and B"), on the Friends page. The prototype (branch `prototype/friends-trio`, commit
3690c52, `src/web/pages/friends/PairPrototype.tsx`) settled the look; this plan builds it.

**Verdict (3690c52), variant A "Mirror":** pair cards in a "Together" section under the friend
cards; the pair page mirrors the single-friend page — scorebug, With | Against zones side by
side, four-segment carry bars, You / A / B column groups. Rejected: B's one-line Against, C's
per-card pair footer. Round 2 (stress view), kept: suggestions as one "Suggested" panel (top 3,
the rest behind "Show N more"), headings Suggested / Your friends / Together, the pair's second
name on its own line, "–" for an empty record on any card, friend-name column headers capped with
an ellipsis.

**Decisions (prototype plan, user 2026-11-02):**
1. Pairs appear on the landing automatically (no picker, no Add, no nickname/remove).
2. Rule = the suggestion rule: A and B both on your team, or both on the other team, in 3+
   matches over 2+ sessions (`SUGGEST_MATCHES`/`SUGGEST_SESSIONS`, `src/server/api/pages.ts:25`).
3. With = both `side: "with"`, whoever else was there; against = both `side: "against"`; one on
   each side counts on neither.
4. Against zone on the pair page from the same code, with its empty state.
5. Without baseline = your matches at that mode where neither A nor B was on your team.
6. Carry: four segments you / A / B / rest; even-share tick at 1/team size.
7. Recap/Trends: links only, via `?with=A,B`; needs `teammateParam` widened (client and server
   share it: `src/shared/schemas/params.ts:21`, parsed client-side in
   `src/web/logic/filter-options.ts:28`), plus what the With `<select>` shows for a pair value.

**Decisions (this plan, user 2026-11-03):** generalize to N friends (one view function, one set of
components; the single-friend page is the N=1 case), and split into **a: data** and **b: page**,
each with its own review.

**Findings carried in:** focus after Add / Never suggest must not land in the closed "Show more";
three-number Against tiles cut off their caption; the 375px check is still open.

Real data: one pair together in 31 matches; no pair has ever both been against you — the pair
Against path has no real data, but it is the same generalized code the single-friend Against
already runs on real data, so no Watch-list item.

## Step 0
Save this plan to `docs/plans/2026-11-03-friends-pairs.md` (Substantial, two sessions).

## Part a — data

### a1. `src/shared/friend-stats.ts`: friendView over a list of ids (TDD)
`friendView(matches, ids: readonly string[], sessionOf)` — `ids` non-empty, distinct.
- `with` matches: every id present with `side === "with"`; `against`: every id `side === "against"`.
- Shapes become per-friend arrays, index 0 = you, then `ids` order:
  - carry shares `number[]` of length `ids.length + 2` (`[you, ...friends, rest]`); `steady`
    drops a match where you or *any* friend switched; MVP index: you 0, friend i → i+1, else on
    your team → last.
  - compare `{ with, without, friends: PerMatch[] }` (replaces `them`); `without` = the mode's
    matches where *no* id is `side === "with"` (for N=1 that is today's rule exactly).
  - against `mvps`/`goals`: `number[]` of length `ids.length + 1`; match lines
    `{ ..., me, friends: StatLine[], mvp: number | null }` (0 = you, i+1 = friend i; replaces
    `them` / `"me" | "them"`).
- `friendCard(matches, ids)` likewise (records need every id on the side; `lastPlayed` = any
  match with all ids present on one side together — for N=1 unchanged).
- Tests (`src/shared/friend-stats.test.ts`): existing cases ported to the new shape (red first
  on the shape change); new pair cases — both with, both against, one each side (neither),
  4v4 carry with a non-zero rest, a switched friend dropped from carry, and Without leaving
  out a match where only one of the pair was on your team (Decision 5).
- `src/web/logic/friends.ts:50` `carryShares` takes `readonly number[]`; its test ported.

### a2. Pair rule, landing data, pair detail — `src/server/api/pages.ts`
- `pairKey(a, b)` = the two ids sorted, so a pair has one URL and one key.
- `friends()` adds `pairs: { ids: [a, b], with, against, lastPlayed }[]`: every pair of friends
  (from the `readLobbies(ids)` already read; matches filtered by `counted`, so offline is left
  out as on the pair page) whose with ∪ against matches number ≥
  `SUGGEST_MATCHES` over ≥ `SUGGEST_SESSIONS` sessions (sessions via `sessionsByGuid(index())`);
  newest `lastPlayed` first. Since friend writes already return `cards`
  (`src/server/api/index.ts:241`), the pairs stay fresh after Add/Remove with no new invalidation.
- `pairDetail(a, b)`: null (404) unless both are friends and differ; returns
  `{ friends: [a, b] as friend rows, view: friendView(readLobbies([a, b]), [a, b], …) }`.
- `friendDetail` passes `[id]`.
- Logging: `query/friend_pairs` `{ friends, pairs }` in `friends()`; `query/pair_detail`
  `{ ids, with, against, modes }` mirroring `friend_detail`. Questions they answer: did a pair
  qualify, and what did its page count.
- Tests (`src/server/api/pages.test.ts`): pair appears at 3 matches / 2 sessions and not at
  3 / 1 or 2 / 2; with+against both count toward the rule; offline matches don't count; a
  non-friend id → null; same id twice → null.

### a3. Schemas and API
- `src/shared/schemas/responses.ts`: `shares` → `z.array(z.number())`; `them` → `friends`
  arrays; `mvp: z.number().nullable()`; `friendsResponse` gains `pairs`; new
  `pairDetailResponse` (`friends: [friendRow, friendRow]`, `view` = the same view schema, so the
  view object is extracted once and shared). Keep `satisfies z.ZodType<FriendView>`.
- `src/shared/schemas/tables.ts`: `pairParams` = `{ a, b }` each like `friendIdParams.id`.
- `src/server/api/index.ts`: `GET /api/friends/pair?a=&b=` → `orNotFound(pairDetailResponse, …)`.
- `src/web/queries.ts`: `usePairDetail(a, b)` with query key `["friend-pair", a, b]`. And
  `useFriendPairs()` on the same `FRIENDS_KEY` with `select: (d) => d.pairs`. `useFriends`
  selects `data.friends` (`queries.ts:156`), and Trends/Recap rely on that shape, so it stays as
  is. It's one cache entry, so the friend writes' `setQueryData` keeps pairs fresh.
  `staleAfter` already marks unlisted keys stale (`invalidation.ts:27,41`), so `friend-pair`
  refreshes after a write with no code change. A test confirms it. After Remove, a cached pair
  page refetches to a 404, and the 404 copy covers that.
- `api.test.ts`: the pair route 200 / 404 / 400.

### a4. `?with=A,B` on client and server
- `teammateParam`: one or two friend ids joined by `,` (each the existing `Platform|id|split`
  shape, distinct), `max(201)`; → `{ friends: [...] }`. Two is the cap: only pairs are built.
  `withTeammate` (`every`) and `teammateValue` already take a list.
- `src/web/components/TeammateFilter.tsx`: when the value names two friends, add one option
  `A + B` (value `A,B`, names from `friends`) after the friend options, so the `<select>` shows
  it; choosing a single friend from there works as today. Not offered otherwise (Decision 7).
- **Order:** `teammateParam`'s transform sorts the ids into `pairKey` order, so `A,B` and `B,A`
  are one value, one select option and one cache key. The extra option's value comes from
  `teammateValue(value)`.
- **Recap with a pair:** `teammateMissing` (`filter-options.ts:35`) checks each id on its own
  against `friendsPresent`, the union over the session (`pages.ts:118-123`). So a session where
  A and B both played, but never together, wouldn't reset, and would show nothing. Fix: when the
  filter names 2+ friends and the session's `summary` is null (no match under the filters), the
  recap resets to Anyone like a missing friend. It logs `recap/with_reset` with
  `reason: "not_together"`. Put this in the `teammateMissing` caller's condition and test it
  (A and B in separate matches of one session → reset). Trends: a pair URL with no shared
  matches in the period shows the normal empty chart, the same as a single friend with none in
  the period. That's accepted.
- `src/web/pages/recap/ShareCard.tsx:50-51`: the naming moves into a pure
  `shareTeammate(friendsPresent, teammate)` in `src/web/logic/share-card.ts`. It names every
  filtered friend, joined " + " (today only the first), and is tested in `share-card.test.ts`.
- Comments updated: `teammate-filter.ts:2-4` ("the pages only ever send one id"),
  `params.ts:18` ("one friend's PrimaryId"), and the `ShareCard.tsx:50` comment.
- Remarks `duo` (`src/server/remarks/triggers.ts:76`) pins when the top friend is either of the
  pair — leave as is; it names one friend, which is still true.
- Tests: `params` (via `filter-options.test.ts` `parseTeammate`): `A,B` ok; three ids, a repeat,
  an empty half, a malformed id → bad. `share-card` naming test for a pair.

### a5. Single-friend page on the new shape (no visible change)
`FriendPage.tsx` reads `friends[0]` / index-based MVP; Carry/Compare/Matches are generalized in
b1, so in part a only the minimal reads change. `bun run` typecheck, lint and full tests green;
the single-friend page checked by eye on real data, unchanged.

End of part a: `/compact` line, then `independent-review-pass` on part a's diff.

## Part b — page

### b1. Generalize FriendPage's parts to `friends: Who[]` (`Who = { id, name }`)
In `src/web/pages/friends/FriendPage.tsx`, from the prototype's code:
- `Carry`/`Bar`: N+2 segments; friend 0 `.them`, friend 1 the prototype's second shade
  (`.b` `#5fc4c4` → a token in `Friends.module.css` / `tokens.css`, both themes); legend keys
  in the note as the prototype did; "rest" note only when rest can be non-zero.
- `Compare`: Mirror order — With / Without / Diff, then one capped column per friend
  (`.cap` max 10em, ellipsis, `title`).
- `Matches`: one 5-column group per person, ★ on the MVP's group, pager kept.
- `AgainstZone`: MVPs/Goals as `n–n–n`. **Caption fix:** the Tile note is one line capped at
  22ch (`Tile.module.css:11`), so "you – A – B" cuts off. Tile gains an opt-in
  `noteLines={2}` (line-clamp 2, `title` keeps the full text); the three-number tiles use it.
- `ModeSwitch` extracted from `Modes` (the prototype already did) — same markup.
- Copy takes `both = "A and B"` for N=2 (headings "Both on your team" / "Both on the other team",
  tiles' note "all three" / "against both", Decision 5's Without note, empty states as in the
  prototype). N=1 copy unchanged.

### b2. Pair page
- Route `/friends/:a/:b` (`src/web/App.tsx`), `PairPage` in `src/web/pages/friends/PairPage.tsx`:
  BackLink, h1 "A + B" (focus like `Friend`), pair Scorebug (TOGETHER / AGAINST BOTH), zones
  side by side from b1's parts. Links appear only when `view.with.record.n > 0`, since a pair
  can qualify on Against alone and `?with=` matches only "with": "Matches with A and B →"
  (`recapPath(null, "everything", "overview", { friends: [a, b] })`) and "Trends with A and B →"
  (`/trends?with=` + `teammateValue`). 404 state: "These two aren't both your friends."
- `pairPath(ids)` next to `friendPath` (`FriendsPage.tsx:19`), ids in key order.

### b3. Landing — `src/web/pages/friends/FriendsPage.tsx`
- Suggested panel from the prototype (`Suggestion` row, `SHOWN = 3`, native `<details>` "Show N
  more"), heading "Suggested"; "Your friends" heading over the cards; "–" / "none yet" for an
  empty record on every card.
- "Together" section after the friend cards when `pairs` is non-empty: `PairCard` (second name on
  its own line), the rule sentence under the heading.
- **Focus after Add / Never suggest (repro first, user 2026-11-03):** the plan review couldn't
  find a path into the closed "Show more". `dropSuggestion` (`queries.ts:232`) removes the row
  before the effect (`FriendsPage.tsx:57-59`) focuses `[data-add][min(acted, len-1)]`, which
  stays in the top 3 or in an already-open disclosure. So b3 first tries it in Chrome with the
  panel in place: top-3 acts with "Show more" closed, acts inside it once open, the last row.
  - Reproduces → the add button at the acted index is skipped if it's inside a closed
    `<details>`; focus goes to the summary, else the h1. Written as a pure `nextFocus` in
    `src/web/logic/friends.ts` with a test for that repro.
  - Doesn't reproduce → no guard. The index rule is kept, and the plan's Review log says why.
  - Either way the `focusTo` log names the target.
- Prototype CSS (`.h2`, `.sugg`, `.more`, `.second`, `.cap`, `.b`) moves into
  `Friends.module.css`; the stress fixture and switcher are not carried over.

### b4. Browser check (Chrome, real data copy)
As the prototype plan: copy the live `%LOCALAPPDATA%\RLTracker\tracker.db` into a scratchpad data
dir, run the tracker on it (`RLTRACKER_DATA_DIR=… RLTRACKER_PORT=49101`, the `dev` script's
command) plus `bun run web:dev`. Check:
- landing: Suggested panel, Together card for the real 31-match pair; Add / Never suggest focus
  with "Show more" closed and open;
- pair page: carry four segments, compare columns, Against empty state; Recap and Trends links
  land filtered to the pair, the With dropdown shows "A + B"; share card names both;
- single-friend page unchanged;
- **375px** (`resize_window`) for landing, pair page, single-friend page: no horizontal page
  scroll, capped headers, tile captions on two lines.
A filled pair Against can't come from real data: covered by a1's tests and a temporary local
fixture only if a visual check is wanted (not committed).

End of part b: `/compact` line, then `independent-review-pass` (UI → `ui-implementation-guidelines`
usability review applies).

## Docs
- BACKLOG: close the trio/duo item; add anything deferred.
- `docs/plans/2026-11-03-friends-pairs.md` Review log per part; commit bodies record the choices.
- Prototype branch stays unmerged; the user deletes it (`git branch -D` is hook-blocked).

## Verification
`bun run check` (typecheck, lint, vitest) green after each part; a1/a2/a4/b3 tests as listed; b4 in Chrome.

## Plan review
plan-reviewer (opus), one round:
1. Med: the closed-"Show more" focus bug wasn't reproducible from the code. → b3 tries to
   reproduce it first and adds the guard only if it's real (user, 2026-11-03).
2. Med: a pair filter on a session where both played, but never together, didn't reset
   (`teammateMissing` checks the union). → a4 resets to Anyone when `summary` is null for a 2+
   friend filter, with a test. The empty Trends case is accepted.
3. Med: a pair that qualifies on Against alone got dead Recap/Trends links. → b2 shows the links
   only when `with.n > 0`.
4. Med: `useFriends` selects `.friends`. → a3 adds `useFriendPairs` on the same key.
5. Low: `?with=` order wasn't normalized. → a4 sorts the ids in the transform.
6. Low: share-card naming had no test seam. → a4 moves it into a pure `shareTeammate`.
7. Low: stale comments. → listed in a4.
8. Low: whether the pair rule counts offline wasn't stated. → a2 uses `counted`, with a test.
9. Low: a cached pair page after Remove. → refetches to a 404, noted in a3.
Checked and fine: invalidation of unlisted keys, the Tile note cap, readLobbies listing every
id, N=1 "without" being unchanged, the duo remark, the 375px check in b4.

## Review log

### Part a, round 1
Tier: Substantial by diff (~385 changed non-test lines). Snapshot `8e22650`. Passes:
`/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify` (4 angles).
- security: no findings.
- code-review: the pair loop runs `together` over every pair of friends (O(F²·matches)).
  [Verified, no fix needed] friends are hand-added (3 in real data) and `readLobbies` only holds
  matches with a friend. The extra rescans this caused are fixed below.
- code-review: `friendCard(lobbies, pair)` rescanned all lobbies, and `together` ran a second
  time for `lastPlayed`. [Fixed] friends() passes the pair's matches; friendCard takes
  `lastPlayed` from its own with/against subsets.
- code-review + arch: `params.ts` imported friend-stats for `pairKey`. [Fixed] moved to
  `shared/teammate-filter.ts`.
- code-review: `usePairDetail` keyed the cache by the caller's order. [Fixed] sorts with `pairKey`.
- code-review: friendDetail/pairDetail copy each other. [Verified, no fix needed] a shared helper
  needs tuple casts or dead branches to give back one row or two. Its session lookup is shared
  now (`sessionLookup`).
- code-review: pairOption repeats shareTeammate's " + " naming. [Verified, no fix needed] the
  fallbacks differ (no option vs "friend"), and each is one line.
- code-review: recapReset's pair check could be the general rule. [Verified, no fix needed] the
  explicit reason is what the `with_reset` log needs (plan review 2).
- code-review + arch + simplify: the two MVP counts used different idioms and rescanned per
  person. [Fixed] one `tally` helper.
- code-review + arch: the misleading `sessionOf?.get` under a lazy `??=`. [Fixed] a narrowed local.
- code-review + arch: dead `?? ""` in pairOption. [Verified, no fix needed] it only satisfies
  `teammateValue`'s return type; joining by hand would repeat the query format.
- arch: the header comment was too long, and FriendPage said "for now". [Fixed] (nits).
- simplify: `without` excludes a match where either friend was with you, not only both.
  [Verified, no fix needed] that's a2's rule, with a test.
- simplify: per-person arrays are positional; FriendPage keeps one-friend fallbacks. [Verified,
  no fix needed] the shape is the plan's (a1). b1 rewrites the page.
- simplify: `friendPairSchema` repeated the card's fields. [Fixed] `friendCardSchema.pick`.
- simplify: pairs ride on `/api/friends`, so the With dropdown's fetch builds the session index
  when some pair qualifies. [Verified, no fix needed] this is plan review 4's choice (one key).
  React Query caches it until a match lands.
- simplify: the tuple union in `teammateParam`, the second friend-id schema, a shared
  suggestion predicate, the ANYONE branch in TeammateFilter, and finding candidates per match.
  [Verified, no fix needed] the tuples type `pairKey(...ids)`; the rest is small or a design
  change not worth its cost at this friend count.
`bun run check` after the fixes: 89 files, 1134 tests, typecheck and lint clean.

### Part a, round 2 (delta `git diff 8e22650`)
Passes: `/code-review low`, arch-reviewer (sonnet), security-reviewer.
- security: no findings. code-review low: no findings.
- arch nit: the header comment's 4th line was still unwrapped. [Fixed] comment only, so the round
  stays closed.
- arch nit: the name `of` and the inline `??=` in friends(). [Verified, no fix needed] it's
  three lines in one scope; a rename isn't worth an executable change.
- arch nit: friendCard repeats `together`'s rule. [Verified, no fix needed] both use `rowsOn`;
  the a2 pair tests check friendCard's with/against/lastPlayed against literals.
- arch q: `index()` isn't memoized. [Verified, no fix needed] each request builds it at most once,
  as before.
No new findings and no `/simplify` edits, so the review is done: 2 rounds, 9 fixed, 0 deferred.

### Part b, implementation notes
- b3 focus: a throwaway Playwright repro (4 suggestions; top-3 acted on with "Show more" closed,
  the last row once open) never put focus in a closed `<details>`: the acted-on index is a
  visible one, and the re-slice keeps `min(acted, len-1)` in the top 3 or in an open disclosure.
  Doesn't reproduce, so no guard; the index rule stays. Deleted after.
- `pairPath` lives in `PairPage.tsx` beside the route that reads it, not next to `friendPath`;
  no import cycle (PairPage doesn't import FriendsPage).
- The friends e2e seed's Kim/Lee/Max matches moved to Casual Quads (4v4) so a pair leaves a real
  fourth teammate; the carry bar reads out a non-zero rest even where `carryRest` says no one can
  fill it (an odd lobby), and its grey moved from `--muted` to `--ink2` (axe contrast). Empty
  segments drop their padding.
- N=1 changes, all deliberate: ★ sits on the MVP's score cell; the bar's label drops "the rest
  0%" in 2v2; the MVPs/Goals notes wrap to two lines instead of cutting off.
- b4 on a copy of real data (3 friends, 0 suggestions, port 49111): the Together card for the one
  qualifying pair, its page (focused h1, scorebug, tiles, carry swatches with no rest in 3v3,
  compare columns, Against empty state), the Recap and Trends links landing filtered with the
  With select reading the pair, the share card's "WITH A + B", and no sideways scroll at 375px on
  the landing, pair and single-friend pages (single-friend page unchanged by eye).
- **For the user to check by hand** (no real data reaches them): a filled pair Against zone (its
  two-line tile captions), and "Show N more" with real suggestions.
- Seen, not this change: the share card's highlight read "039% above your 30-day average", and
  thin carry segments clip their "You 17%" label at narrow widths. Both pre-existing.

### Part b, round 1
Passes: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`, the UI
usability review. Snapshot `ab23db6`.
- security: no findings.
- code-review bug: removing one friend left a cached pair page showing its old stats (a failed
  404 refetch keeps the cached data, so a3's "the refetch shows the 404" didn't hold). [Fixed]
  `useRemoveFriend` also drops every `friend-pair` query naming the id; e2e regression test
  (red first).
- code-review: `max-width` on a `<th>` is ignored, so long names never cut. [Fixed] names sit in
  an inline-block `Cap` span; this also covers arch's duplicate cut-off CSS nit.
- code-review: one-vs-pair wording still inline beside `sideCopy`. [Fixed] moved into `sideCopy`
  (empty states, With column, carry words, Compare note), with literal tests.
- code-review + arch: a pair with a missing name rendered nothing and could leave an empty
  Together section. [Fixed] filtered first, logged `friends/pair_unnamed`, section only when any
  remain.
- code-review + arch: an empty record read "none yet" then "not yet". [Fixed] the visible line is
  `aria-hidden`.
- code-review: `carryRest`'s cast hid "the undefined teammate" for (2v2, 0 friends). [Fixed]
  lookup keyed by team size, no cast; test added.
- code-review: the first heading jumped down when an error line showed above it. [Fixed] the
  selector also matches `.error`.
- arch nit: stale "banner" comment. [Fixed]
- arch q: `pairPath` placement. [Verified, no fix needed] recorded above.
- arch nit: `SHADES` has two entries. [Verified, no fix needed] the API only builds pairs.
- `/simplify` edits: Compare's `diff()` takes an undefined first value; the With zone tests its
  count once; PairPage renders the back link once around a `Body`. Skipped: a shared detail
  shell for FriendPage and PairPage (different states and copy, ~15 lines); Tile notes always
  two lines (changes Recap's tiles); a friend-query key helper (one caller); the one-friend carry
  legend as swatches (a wording change).
- usability: states (loading, 404, error with Retry, empty zones), focus on load, links as real
  links and the native `<details>` all consistent with the single-friend page; no new finding.
After the fixes: `bun run check` 89 files, 1138 tests, typecheck and lint clean; e2e 79 passed.

### Part b, round 2 (delta `git diff ab23db6`)
Passes: `/code-review high` (the first run reviewed the snapshot's own range by mistake and
re-found round 1's nine, all already fixed; re-run on the delta), arch-reviewer (sonnet),
security-reviewer.
- security: no findings.
- code-review (2nd finding on the stale-page topic, now with a clean general fix): a friend
  removed anywhere but this tab's Remove (another tab) left the cached page showing after its
  refetch 404'd. [Fixed] on both `FriendPage` and `PairPage` a 404 wins over cached data; e2e
  "…removed elsewhere" (Remove via the API, then Suggest again in the tab to mark it stale; red
  with the old condition). `removeQueries` stays, so this tab's Remove doesn't flash old data.
  Reverted in round 3 (the user's call), see below.
- code-review + arch nit: the `pair_unnamed` warn ran on every render. [Fixed] the name join
  moved into `useFriendPairs`'s module-level `select`, which runs once per answer.
- code-review: `useRemoveFriend`'s JSDoc didn't mention pair pages. [Fixed]
- code-review: the pushState snippet three times in the spec. [Fixed] `goInApp` helper.
- code-review: the error-state h1 is never focused. [Deferred → BACKLOG Watch list] the same as
  the single-friend page, outside the focus contract, and keyboard access is unaffected.
- code-review: `LAST["2"]` covers an input callers don't send. [Verified, no fix needed] it is
  what lets `LAST[size]` type-check with no cast.
- code-review: the pair key layout isn't shared with the `removeQueries` predicate.
  [Verified, no fix needed] one caller, two lines apart in the same file.
After the fixes: `bun run check` 89 files, 1138 tests, clean; e2e 80 passed. Snapshot `4647fbd`.

### Part b, round 3 (delta of round 2's fixes against `ab23db6`)
Passes: `/code-review high`, arch-reviewer (sonnet), security-reviewer.
- security: no findings. arch: two nits, both already dispositioned (error-state focus on the
  Watch list; the pair key layout).
- code-review, the third finding on the stale-page topic: "404 wins" lost focus when the page
  swapped, and wrongly showed "aren't both friends" while a re-added friend's page refetched;
  it also left round 1's `removeQueries` untested (the 404 branch covered for it). Stop rule:
  taken to the user with a simpler design among the options. **User's decision (2026-11-03):
  keep round 1 only.** [Fixed] "404 wins" reverted on both pages and its e2e test removed; round
  1's test is red again without the pair `removeQueries` (checked). A removal made in another tab
  shows old stats until a reload or the next live event, as the single-friend page always did.
  [Deferred → BACKLOG Watch list]
- code-review: `namedPairs` is untested pure logic in queries.ts. [Fixed] moved to
  `logic/friends.ts` with a unit test (red first).
- code-review: `path ?? ""` hides a missing href. [Fixed] asserted non-null first.
- code-review: the inline comment in `useRemoveFriend` repeated the JSDoc. [Fixed] dropped.
- code-review: the shared 404 helper, and FriendPage's three BackLinks. [Verified, no fix needed]
  the helper went with the revert; FriendPage is otherwise untouched by part b.
- code-review: the spec hard-codes the request header. [Verified, no fix needed] `pairUp` is now
  its one use; the other e2e specs do the same.
After the fixes: `bun run check` 89 files, 1139 tests, clean; e2e 79 passed.

### Part b, round 4 (delta `git diff 4647fbd`)
Passes: `/code-review low`, security-reviewer. No findings, and no `/simplify` edits, so the
review is done: 4 rounds, 15 fixed (round 2's 404 fix later reverted), 2 deferred to the
Watch list (error-state focus; a removal in another tab).
