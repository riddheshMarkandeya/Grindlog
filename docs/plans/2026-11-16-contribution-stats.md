# Contribution stats: the real build (friends release map step 6.1)

## Context
Friends asked for two things: (a) a split of you vs your team per session (and per match), fair across
2v2/3v3, with friends broken out when filtered; (b) touches split by field zone. Both were grilled and
then settled by prototype on 2026-11-16. The record is `docs/plans/2026-11-05-friends-release-map.md`
§6 item 1: recap variant D, match variant M1, and the build scope (goal names, Shots/Touches on
Friends, no Friends touches panel). Branch `prototype/contribution` (`9fe8156`) is reference only. It
computed shares in the browser from N match fetches and read zones from a precomputed JSON. The real
build stores zones and computes the shares on the server.

Tier: **Substantial**. It adds a stat rule and a migration, a new shared module, and three pages, at
~700–900 lines. It runs as **two work packages** (data, then UI) with a compact point between them.
Each package fits one session.

## Decisions this plan takes (from the map, plus this session)
- Rows, in the prototype's order: Score, Goals, Assists, Saves, Shots, Touches, MVPs. The % sits inside
  the bars with no raw column. Hovering a segment gives `Name · 26 of 30 · 87%` on every row, Score and
  Touches included.
- One rule for both pages: Contribution keeps Friends' existing match set. That is per mode
  (`modeOf`), with team-switch matches left out. The prototype's extra "team at full size" filter is
  **not** carried over. Rest = team total − you − listed friends, labelled "Teammate" when one seat is
  left and "Teammates" when more. This replaces "Others" and "2nd/3rd/4th teammate" on Friends too.
  The bars say "Opponents" (the scoreboard already does).
- Touches are **our counted touches** (the `touch_merge` rule), not the game's scoreboard `touches`.
  The map recorded the agreement (0.97× median, so no note is needed).
- Zones: thirds from each player's **own** goal (defence/midfield/attack), cut at ±`GOAL_LINE_Y`/3. The
  ball position is the counted touch's. The team is the hitter's team **at that hit**, so a mid-match
  switch is framed right; if the hit has no team, the roster's last team is used.
- "Where the touches were" (recap) uses the same match set and the same mode picker as Contribution.
  Under **3 matches** in the picked mode, its note adds "A few matches swing these a lot." (user's
  choice, 2026-11-16).
- Goal names: the stored goal list gains `scorerName`/`assisterName` through one join in `readGoals`,
  so every goal map's hover names people, the recap's included. "You" is used for you, as scorer or
  as assister.
- Friends gets Shots and Touches rows and the rename to "Contribution · stats with them". The
  per-match table's region becomes "Contribution, per match". Friends gets no touches panel.

## Work package A: data (server + shared)

**A1. Measure first (read-only, real data).** Count the BallHit hitters with no `TeamNum` in the dev
raw.db with a scratch query. That one figure decides A2's flagging. The data doesn't show the shape
yet, so per CLAUDE.md §2 it gets the existing check plus a BACKLOG Watch item.

**A2. Touch thirds as stored extras** (TDD, pure):
- `src/server/recorder/play.ts`: each `Play.touches` entry carries `team` along with its position.
  `countTouches` takes it from the hitter; if the hit has none, it takes the roster's `teamNum`.
  - The fallback gets its own fact, `facts.hitterNoTeam`. It is **not** a `RefKind`, because a missing
    team isn't an unresolved reference, so `reference_resolution` stays untouched and needs no bump.
  - `touch_thirds.checks` lists `touches_resolved`, extended to report `hitterNoTeam` with its own
    label. The check is shared and isn't versioned itself.
  - If A1 finds the shape common, the fallback stays, A1's figure goes into the rule text, and no
    flag is added.
  - Tests: `play.test.ts` (each hitter's team in a 50/50, the roster fallback, a mid-match switch) and
    `checks.test.ts` (the new label).
- `src/server/recorder/extras.ts`: three `PLAYER_EXTRAS` entries, `touches_defence`,
  `touches_midfield` and `touches_attack`, with the constant `THIRD_Y = GOAL_LINE_Y / 3`. Their range
  check: the sum is ≤ the count of positioned touches, so they can't exceed it by construction. Use
  `inRange: null`, as for the other counts. The writer (`records/save.ts`) and the checks pick the
  entries up from the registry by themselves.
  - Tests in `extras.test.ts`: the boundaries at ±`THIRD_Y`, team 0 and team 1 orientation, and the
    hit-time team winning over the roster's.
  - Seeds: add distinct thirds to `src/server/testing.ts` `player()`'s default extras (line 59), and
    give the players in `test/e2e/stack.ts` distinct values. Otherwise every seeded match has null
    thirds, and B6 can't test the percentages or the row order.
- Arenas: `THIRD_Y` assumes the standard pitch, and Hoops and Dropshot are shaped differently. The
  thirds are computed for every match, and the rule text says they're only meaningful on the
  standard pitch. The recap already leaves those modes out through `modeOf`; B5 hides the match
  panel for them.
- `src/server/db/migrations.ts`: append a migration with three nullable `INTEGER` columns (null means
  not computed until recompute, as the existing extras comment says). The existing migration test
  fails for a registry column with no migration.
- `src/server/rules/registry.ts`: a new rule `touch_thirds` (area extras, version 1, constants
  `THIRD_Y`/`GOAL_LINE_Y`, outputs the three columns). Its evidence is the 27-session zone check. The
  three columns are added to the `outputs` of `live_play_window`, `every_entry_a_hitter`,
  `reference_resolution` and `touch_merge`. Then `bun run definitions`.
- Orientation: confirm the "team 0 attacks +y" assumption against `logic/goal-map.ts`'s `toScreen`.
  That orientation was checked against a replay on 2026-11-09. The test pins it.

**A3. Read layer** (`src/server/query/read.ts`, extend `read.test.ts`):
- `readLobbies(friendIds, range?)`: an optional `{ guids }` limits both queries through the existing
  `where(range)`, so the recap doesn't read every player row in history.
  - `where` emits `m.guid IN …`, so the player query needs
    `JOIN matches m ON m.guid = match_players.match_guid`.
  - It also reads the three touch columns.
  - `Line` gains `thirds: [d, m, a] | null`. `LobbyMatch` gains `touchesComputed` (every player row
    of the match has non-null thirds), `teamThirds` and `opponentThirds`.
  - `myTeamTotals` gains `shots` and `touches`.
  - Touch values are summed only for computed matches. Null is never read as 0 into a count (the
    `car_share_aggregate` principle).
- `readMatch`: each player gains `thirds: [d, m, a] | null`.
- `readGoals`: two `LEFT JOIN match_players` (scorer and assister on `match_guid` + key) give
  `scorerName`/`assisterName` (nullable).
- Every read stays inside `timed(...)`, so the cost is logged as `query/read` lines.

**A4. Shared contribution logic** (new `src/shared/contribution.ts`, `contribution.test.ts`; TDD):
- Move the carry computation out of `friendView`: `carryOf(steady, ids)` →
  `{ matches, score, goals, assists, saves, shots, touches, mvps }`. Each is a `[you, ...ids, rest]`
  array. `mvpIndex`/`tally` move with it. `friendView` calls it. The existing `friend-stats.test.ts`
  carry tests stay green; extend them for shots and touches.
- `sessionContribution(lobbies, ids)` → `{ modes: { mode, matches, carry, thirds }[], defaultMode }`.
  - `thirds` is `{ matches, by: [you, ...ids, rest, opponents] }`, each `[d, m, a]`, over the steady
    matches with `touchesComputed`. `carry.touches` uses the same subset. The panel's N and the
    under-3 caveat read `thirds.matches`.
  - `defaultMode` is the most-played mode (map line 62); a tie goes to the earlier one in `MODE_ORDER`.
  - Friend rows come from the existing `rowsOn(m, ids, "with")`, and ids = [] for anyone/solo.
- Tests:
  - modes split, switches left out, rest = team − people;
  - opponents' thirds, shots and touches;
  - a match with null thirds left out of touches but kept in the other rows;
  - the tie-break;
  - no moded match gives `null`.

**A5. API** (`src/server/api/pages.ts`, `src/shared/schemas/responses.ts`, `pages.test.ts`):
- `sessionDetail` adds
  `contribution: sessionContribution(reader.readLobbies(ids, { guids: matches.map(m => m.guid) }), ids)`.
  `ids` are the teammate filter's friends, or [].
- Schemas: `carry` gains `shots` and `touches`; `sessionDetailResponse.contribution`; match player
  `thirds`; `goalSchema` `scorerName`/`assisterName`.

**A6. Prove it on real data.**
- `bun run check`.
- `bun run rules-diff`: expect the three new columns to move, plus `check_flags` only where
  `hitterNoTeam` fires (A1 predicts how many).
- `bun run deploy`, which runs check, e2e, install and recompute.
- Spot-check one single-mode session with no team switch against the prototype's per-session table.
  The prototype used every mode and each player's final team, so mixed sessions only get a
  tolerance of a few points. Your team's touch share should be ≈ 45%. Release builds recompute on the version bump by themselves
(`release-recompute.ts`).
→ **Compact point** (`/compact`, resume at B1).

## Work package B: UI (`ui-implementation-guidelines` applies; invoke it at B1)

**B1. Shared pieces** (move, don't copy):
- `components/ModeSwitch.tsx` comes out of `pages/friends/zones.tsx` with its `.switches`/`.seg` styles.
  `components/WlBar.tsx` comes out of `pages/friends/parts.tsx`.
- `components/Contribution.tsx` + `.module.css`: Friends' `Carry`/`Bar` with the `.carry`, `.bar`,
  `.split`, `.me`, `.rest`, `.tick`, `.legend`, `.key` and friend-shade styles moved out of
  `Friends.module.css`. Props: carry, mode, friends, rest label, note. It adds a hover `title` per
  segment, keeps the existing `role="img"` aria-label per bar, and has the Shots and Touches rows.
- `logic/friends.ts`: `carryRest` returns "Teammate"/"Teammates"/null, and `OTHERS` becomes
  "Teammates". Update `friends.test.ts` first.
- `components/TouchThirds.tsx` + `logic/thirds.ts`, with `thirds.test.ts` written first.
  - Pure logic: % per third, and the match rows ordered your team first with you on top, then the
    opponents.
  - With no team of yours (spectated, or the `e2e-few-noteam` seed), the game's team 0 comes first
    and the rows say "Blue team"/"Orange team", matching the scoreboard. It provides the legend (each zone's square split
  diagonally blue/orange) and a stacked bar row. The shades come from `--blue`/`--orange` via
  `color-mix` in `tokens.css`, so carbon, slate and OLED all work. Check the contrast of the % text
  on the lightest shade.

**B2. Friends** (`pages/friends/zones.tsx`): `Modes` renders `<Contribution>` under the title
"Contribution · stats with them". Rename the region and the file-head comment. Update
`test/e2e/friends-page.spec.ts`: the region name at :182 (`/^Contribution · /`), and the
"3rd/4th teammate"/"Others" legend labels at :105, :177 and :179.

**B3. GoalMap** (`components/GoalMap.tsx`, `.module.css`, `logic/goal-map.ts`): one layout for both
pages. The pitch sits above its legend. Below them, Scored and Conceded sit side by side with one
note line: "You scored x of the team's y." plus the close/long definition. `titleOf` names the
scorer and assister from the goal's names, using "You" for you. Without names it falls back to the
current wording. Unit tests in `goal-map.test.ts`.

**B4. Recap, variant D** (`pages/recap/Overview.tsx`, `.module.css`):
- Per game keeps its own row, and By playlist leaves `PerGameAndPlaylists`.
- Below it, a two-column grid (≈3fr / 2fr, one column on narrow widths). On the left, "Where the goals
  came from". On the right, three sections:
  - By playlist as `WlBar` rows, hidden with one playlist.
  - Contribution, with the mode picker or a plain label for one mode. It defaults to
    `contribution.defaultMode`. Its note reads "Your share of the team's total over N 2v2 matches
    this session. The tick is an even share (50%). Hover a bar for the numbers."
  - "Where the touches were", driven by the same picker state: rows for You, the filtered friends,
    Teammate(s) and Opponents. Its note gives the counted touches over N matches, thirds from each
    team's own goal, and under 3 matches adds "A few matches swing these a lot."
- Extras and Highlights stay full width below.
- Empty states:
  - `contribution === null` (only 1v1, LTMs, uneven privates and the like): Contribution and the
    touches panel are left out. If By playlist is hidden too, the grid collapses so the goal map
    takes the full width.
  - `carry.matches === 0` (every match had a switch): Friends' message carries over ("Every 2v2
    match this session had a team switch…").
  - `thirds.matches === 0` (not yet recomputed): the touches panel says "No touch data yet."
  - The Contribution note keeps Friends' sentence about switched matches being left out.

**B5. Match page, M1** (`pages/recap/MatchView.tsx`): "Where the touches were" goes below the
Scoreboard. It has one bar per player (your team first, you on top) and the raw touch count at the
end, with no percentage line under it. Long names truncate with an ellipsis and show in full in the
title. If any player's `thirds` is null, the panel says "No touch data for this match." The panel is
hidden on playlists that aren't played on the standard pitch (Hoops, Dropshot and the like, by
`playlistInfo` group or id). Private matches can't be told apart, so they show it. The goal map
below it gets B3's layout. Hovers name the scorer and assister.

**B6. e2e and real-browser check:**
- `recap.spec.ts`: Contribution, its picker, and the touches panel with the same mode.
- The match page: the touch rows, and a goal mark's title naming the scorer.
- `friends-page.spec.ts`: the Shots and Touches rows, and the "Teammate(s)" legend.
- A `recap-few`-style case: a session with only unmoded matches (Contribution and the touches panel
  absent), and one with 1–2 matches (the caveat shows).
- axe stays clean.
- Then the dev install in Chrome: the recap (one and several playlists, a friend filter, a 1–2 match
  session), a match page, and a friend and a pair page, in all three themes and at narrow width.

## Package B interaction contract (added at B1, 2026-11-16)
Theme: the existing `tokens.css` (carbon, slate, OLED). The design comes from prototype variants D and
M1. One loading model: the panels render from the page's existing query and have no loading or error
state of their own.

| Trigger | What shows | Focus |
|---|---|---|
| Recap: mode switch (size or kind button) | Contribution and "Where the touches were" both switch to that mode | Stays on the pressed button (`aria-pressed`); a disabled kind is `aria-disabled` and does nothing, as on Friends |
| Recap: only one mode | A plain mode label instead of the switch | — |
| Hover over a bar segment | A native `title`: `Name · 26 of 30 · 87%` (Score and Touches the same) | Segments aren't focusable. Each bar's `role="img"` `aria-label` reads every share, so keyboard and screen-reader users get the same numbers |
| Recap: teammate filter or playlist filter changes | The session refetches. The picked mode is kept if the new data has it, otherwise `defaultMode` (`pickMode`) | Unchanged |
| Recap: prev/next session, Back/Forward, reload | The panels remount with the session's `defaultMode`. The pick isn't in the URL, as on Friends | Page's existing rule |
| Recap: `contribution === null` | Neither panel shows. With By playlist hidden too, the goal map spans the full width | — |
| Recap: `carry.matches === 0` | Contribution shows the team-switch message; the touches panel says "No touch data yet." only when `touchMatches === 0` for another reason | — |
| Recap: `carry.touchMatches === 0` | The Touches bar reads "none yet"; the touches panel says "No touch data yet." | — |
| Recap: `0 < touchMatches < 3` | The touches note adds "A few matches swing these a lot." | — |
| Friends: `touchMatches < matches` | The Contribution note adds "Touches over N of them." (matches not yet recomputed) | — |
| Match page: any player's `thirds` null | "No touch data for this match." | — |
| Match page: non-standard-pitch playlist | No touches panel | — |
| Match page: long name | Truncated with an ellipsis; the full name in `title` | — |
| Goal mark hover (both pages) | A `title` naming the scorer and assister, with "You" for you; without names, today's wording | Marks keep their current focus behaviour |
| Width 320px | The recap grid stacks into one column; bars keep their labels (a % shows only when its segment is wide enough) | — |

## Docs (at the end, per `documentation-backlog-hygiene`)
- Copy this plan to `docs/plans/2026-11-16-contribution-stats.md` as the first step after approval.
- Add a `PROJECT_INDEX.md` plans entry, and name `shared/contribution.ts`, `components/Contribution.tsx`
  and `TouchThirds.tsx` in the layout.
- Mark step 6.1 done in the map, add a CHANGELOG Unreleased entry, regenerate `docs/definitions.md`
  (A2), and add a BACKLOG Watch item for the hitter-team flag (A2).
- No ADR: one new rule with its version in the registry falls under the existing extras ADR. The
  commit body records it.

## Verification
- `bun run check` (typecheck, lint with zero warnings, unit tests) after A2–A5 and again after B1–B5.
- `bun run rules-diff` (only the new columns move), then `bun run deploy`, which runs check, e2e,
  install-autostart and recompute.
- `bun run e2e` for the UI package.
- The real-data spot-check in A6 and the Chrome pass in B6.
- `independent-review-pass` per package, by the actual diff.

## Plan review
plan-reviewer (opus), round 1. Every finding was folded in:
1. **High.** The e2e seeds had no thirds, so B6 couldn't pass. **Fixed in A2:** `testing.ts`
   `player()` and `stack.ts` get distinct thirds.
2. **Med.** A `hitterTeam` RefKind would change `reference_resolution` without a version bump.
   **Fixed:** it becomes its own fact, `facts.hitterNoTeam`, reported by `touches_resolved` under
   `touch_thirds`.
3. **Med.** Null thirds read as 0 would inflate the match count N. **Fixed in A3/A4:**
   `touchesComputed`, with `thirds.matches` counted separately.
4. **Med.** The recap had no UI state for unmoded sessions or all-switch sessions. **Fixed:** B4's
   empty states, plus an e2e case.
5. **Med.** The thirds are wrong on non-standard arenas. **Fixed:** the rule text says so, and B5
   hides the match panel on those playlists.
6. **Low.** The player query has no `m` alias for `where`. **Fixed in A3:** the JOIN is spelled out.
7. **Low.** The A6 spot-check didn't compare like with like. **Fixed:** one single-mode session with
   no switches, or a tolerance.
8. **Low.** Test files weren't named. **Fixed:** `play.test.ts`, `extras.test.ts`, `checks.test.ts`,
   `thirds.test.ts`, and the `friends-page.spec.ts` lines.
9. **Low.** The match rows had no order without a team of yours. **Fixed in B1:** team 0 comes first,
   labelled Blue/Orange.
10. **Low.** `defaultMode` had no tie-break. **Fixed:** the earlier one in `MODE_ORDER` wins.

The reviewer also confirmed:
- BallHits survive thinning, so recompute fills the new columns on thinned matches.
- The orientation is already pinned at `play.ts:206`.
- The goal-name joins can't duplicate rows.
- rules-diff credits a new rule correctly.
- `ids = []` gives the right labels.

## Implementation notes: package A (2026-11-16)
- **A1**: every one of 57,800 BallHit hitters on 284 matches had a `TeamNum`.
- **Deviation from A2 (the fallback and `hitterNoTeam` were dropped)**:
  - `resolveTarget` resolves a hitter only when its team matches, so a hitter without a team never
    gets a key. It is already counted as an unidentified hitter under `touches_resolved`.
  - That makes the planned roster-team fallback and its `facts.hitterNoTeam` dead code (§2: no
    handling for impossible states).
  - A touch's `team` is the hit's. `touch_thirds` lists `touches_resolved`, and its rule text says
    why.
  - No new unseen shape, so no BACKLOG Watch item.
- The three columns joined `HIT_STATS`, so `dedup_repeat_ballhit`, `live_play_window` and
  `reference_resolution` list them; `every_entry_a_hitter` and `touch_merge` do too.
- `shared/lobby.ts` is the base module. It holds the lobby types, the thirds helpers and the mode
  helpers (`MODE_ORDER`, `modeOf`, `rowsOn`, `mvpIndex`, `tally`, `steadyOnly`, `Together`).
  - `contribution.ts` (carry and thirds) and `friend-stats.ts` both import from it, so neither
    depends on the other except for `friend-stats → contribution` (`carryOf`).
  - This replaces the earlier note; review round 1 changed it.
- **A6 results**:
  - `bun run check`: 1,777 passed.
  - `rules-diff`: 287 recomputed, 0 failed, no change. Only `touch_thirds` was credited, on 287
    matches, and no check flag moved.
  - `bun run deploy`: 113 e2e passed; the recompute had 0 failures.
  - All 1,294 player-matches in the prototype's zone file match the stored thirds exactly.
  - Your team's touch share is 46.4% over every moded session; the prototype had 45.1% over all
    modes.
  - Your defence share is 35–55% in multi-match sessions, teammates' 28–40%.

## Implementation notes: package B (2026-11-16)
- **B1 + B2 done** (Friends uses the shared pieces as soon as they move, so B2 landed with B1).
  `components/ModeSwitch.tsx`, `WlBar.tsx` (takes a `className`; Friends' narrow `.pl` layout passes
  `plBar`), `Contribution.tsx` and `TouchThirds.tsx` share `components/Bars.module.css`. `MODE_LABEL`
  moved to `logic/friends.ts`; `shareTitle` gives the hover (`You · 12 of 31 · 39%`).
- `Contribution` takes `scope` ("together", "with both", "this session") and builds the switched-match
  sentence from the friend count ("you", "either of you", "any of you"), so `sideCopy.anyOfYou` went.
  Every note ends "Hover a bar for the numbers." on both pages. "Touches over N of them." shows
  whenever `0 < touchMatches < matches`, on the Recap too.
- **Deviation:** a match with no team of yours shades its touch rows **neutral**, not blue/orange.
  `tokens.css` says blue/orange mean your side and the other, never a game team, and the scoreboard
  already gives the game's teams no tone in that case. The legend goes neutral with them. Rows keep
  the scoreboard's order (blue team first).
- Third shades are `--third-{blue,orange,neutral}-{1,2,3}` in `tokens.css` (`color-mix` from the side
  colour); `--ink` text on step 1, `--page` on 2 and 3. Contrast still to check in B6's Chrome pass.
- `bun run check`: 1,785 passed, 1 skipped. `friends-page.spec.ts`: 12 passed (B1/B2 point).
- **B3 done.** `GoalMap` is one stacked layout (pitch, legend, Scored | Conceded, one note), capped at
  760px so the full-width match page draws it no bigger than the recap's column. `whoOf` in
  `logic/goal-map.ts`: "you scored", "Sam scored, assisted by you", "conceded: Rival scored…"; a
  scorer with no name keeps the old "a teammate's goal"/"conceded" (you're always named).
- **B4 done.** `Overview` keeps Per game alone, then `GoalsAndShares` (3fr/2fr from 900px, either side
  alone full width). `pages/recap/SessionShares.tsx` holds `PlaylistBars` (a list of WlBar rows; the
  Goals/g column and `PlaylistRow.goalsPerGame` went) and `ContributionSections`, keyed by session so
  the pick survives a filter change but not a session change. With `carry.matches === 0` the touches
  panel is left out (Contribution already explains). `FEW_MATCHES = 3`.
- **B5 done.** `MatchTouches` under the scoreboard (same query, nothing until loaded); hidden by
  `standardPitch` (ids 17, 23, 27, 29, 37, 54, 70: Hoops, Dropshot, Dropshot Rumble, Knockout).
- **B6 (automated) done.** HAT_TRICK's ME seeds thirds 6/2/1 (distinct from everyone's 2/2/1). New or
  rewritten e2e: the recap layout at 1024/320, the picker driving both panels with the 1-match caveat
  and a segment title, an unmoded private session with neither panel, the match page's rows and named
  goal titles, and neutral rows for the spectated `few` match. The existing 320px no-scroll and axe
  loops cover the new panels.
- Contrast of the third shades, computed from the tokens: lowest `--page` on `--third-orange-2` ≈ 5.0:1;
  `--ink` on the deep steps ≈ 6.5–7.3:1. All pass AA.
- `bun run check`: 1,787 passed, 1 skipped. `bun run e2e`: 115 passed.
- **B6 Chrome pass done (2026-11-16)** on the dev install after `bun run deploy` (check, 115 e2e,
  install, recompute: 287 written, 0 failed). Covered: recap with one playlist (3v3 only), several
  playlists with 2v2 and 3v3 (the picker drives both panels, focus stays on the button), a friend
  filter (their colour and row, the rest "Teammate"), a 1-match session (the caveat), a match page
  (you on top, counts, named goal hovers), a friend and a pair page; carbon, slate and OLED; 320px in a
  320px iframe (the window wouldn't shrink). No console errors; keyboard pass fine. Measured in the
  browser, every third shade passes AA in every theme; lowest `--page` on `--third-orange-2` in
  slate, 4.83:1. Found and fixed (after the review snapshot):
  - Touch row names cut ("Teammat…") by the 64px name column: now `fit-content(min(9em, 35%))`,
    which also replaced the match page's `names` variant.
  - % labels clipped mid-number at 320px (an 18% third read "1"): fixed percent cut-offs can't know
    the bar's width, so `components/BarPct.tsx` labels each segment, which is a CSS size container
    that hides "You " under 64px and the label under 40px. A 320px e2e asserts no visible label
    overflows its segment.
  - "none yet" on a finished session's empty row: "none".
- The 760px goal map cap also applies on the recap when the goal map stands alone (one playlist, no
  team mode): kept, so the pitch reads the same size everywhere rather than stretching to 1200px.
- `bun run check`: 1,790 passed, 1 skipped. `bun run e2e`: 115 passed (after round 1's fixes).

## Review log
### Package A, round 1 (Substantial: code-review high, arch-reviewer opus, security-reviewer, simplify)
Snapshot of the reviewed state: `a8014af` (`git stash create`).

- **security**: no findings.
- **[Fixed] Touch shares had no match count of their own.** (code-review 1, arch contribution.ts:86)
  - `carry.touches` covers only the recomputed matches, but `Carry` exposed just the steady count.
  - Fix: `Carry.touchMatches` added.
  - `ContributionMode.thirds` is now just the `Thirds[]`, and its N is `carry.touchMatches`.
- **[Fixed] "Not computed" was stored as zeros next to a flag.** (code-review 4, arch read.ts:448)
  - Fix: `LobbyMatch.touches: { team, opponents } | null` replaces `touchesComputed`,
    `teamThirds`, `opponentThirds` and `myTeamTotals.touches`. `myTeamTotals` is now `Stats`.
- **[Fixed] Type-level import cycle.** (arch contribution.ts:5, friend-stats.ts:12)
  - Fix: the lobby types and the thirds helpers moved to a new `shared/lobby.ts`.
  - The `friend-stats` re-export is gone, and the test imports `modeOf` from `./contribution`.
- **[Fixed] `addThirds` written twice** (code-review 6). Fix: it lives once in `lobby.ts`, as
  `addThirds`/`sumThirds`/`touchesOf`.
- **[Fixed] Session thirds and carry touches were two separate walks** (code-review 7). Fix: both
  now come from one helper, `thirdsBy`.
- **[Fixed] `defaultMode` counted switched matches** (code-review 8).
  - It now picks the most steady matches, with ties going to the earlier mode in MODE_ORDER.
  - Test added; the wording matches the plan.
- **[Fixed] Arch nit, `touchesOf` read null as 0.** It now runs only on computed matches, and its
  fallback is commented.
- **[Fixed] friendView carry tests were loosened** (arch friend-stats.test.ts:141). They are
  `toEqual` again, with shots, touches and `touchMatches`, and a computed match is seeded.
- **[Fixed] Nits**: the readLobbies doc now mentions `guids`; the readFriends test indent; the
  orphaned `shares` comment in responses.ts.
- **[Verified, no fix needed] Empty player list reading as computed** (code-review 3).
  `playersOf` includes your own row, and a match without your row is dropped by `pickMe`, so
  `players` is never empty.
- **[Verified, no fix needed] An unlisted player's team switch** (code-review 2).
  - That player's touches land in their final team's totals.
  - Each touch's third is still oriented by its hit-time team.
  - Score, goals and the other rows follow the same final-team rule Friends already uses, and
    `steadyOnly` checks only you and the listed friends. This stays consistent with the existing
    carry rule.
- **[Verified, no fix needed] Private Hoops and Dropshot fall into p2/p3** (code-review 5).
  - The plan already accepted this: "Private matches can't be told apart, so they show it".
  - The rule text says the thirds are approximate off the standard pitch.
- **[Deferred to B6] Distinct thirds in the e2e seeds** (arch stack.ts:1).
  - The seeds belong with the specs that read them.
  - B6 adds distinct `touches_*` extras to `test/e2e/stack.ts` before writing the percentage and
    row-order assertions.
- `bun run check`: typecheck and lint clean, 1,776 passed. One tray-exe timing test timed out under
  full-suite load and passed on its own (7 passed); it is unrelated.
- **/simplify (4 angles)**:
  - **[Fixed]** `thirdsBy` ran twice per mode. `carryAndThirds` now computes it once, and
    `carryOf` wraps it.
  - **[Fixed]** The mode helpers moved down into `lobby.ts` (altitude: the Friends page read as
    depending on the Contribution module).
  - **[Fixed]** `addThirds` and `Shares` are no longer exported. `thirdsBy` no longer spreads each
    match. `read.ts` `total` uses `sum`.
  - **[Skipped]** A shared `byMode` for friendView and sessionContribution. The shared part is two
    lines (mode filter, `steadyOnly`), and friendView adds its own `without`.
  - **[Skipped]** Team sums from per-player lines instead of `LobbyMatch.touches`. That would need
    every player's line on `LobbyMatch` for no change in behaviour.
  - **[Skipped]** A discriminated `LobbyMatch` type to drop the `thirdsOf` fallback. The invariant
    is documented on the type, and the fallback is commented.
  - **[Skipped]** Making `Hit.hitters` team non-null, plus an `inRange` sum check. That changes
    shared hit resolution outside this diff, and the registry has no multi-column check.
  - **[Skipped]** Goal names resolved on the client. The plan's build scope chose the join.
  - **[Skipped]** Guid narrowing through `json_each` in the player query. `where()` is the shared
    idiom.
  - **[Skipped]** The efficiency nits about the Friends full-history read. Friends shows the
    Touches row, so the work isn't wasted.
- `bun run check` after the fixes: 1,777 passed, lint and typecheck clean.

### Package A, round 2 (delta `git diff a8014af`: correctness-reviewer, arch-reviewer sonnet, security-reviewer)
- Correctness and security found nothing; every [Fixed] entry is confirmed closed.
- Arch found 2 nits in `contribution.ts` (a double blank line, a garbled `carryAndThirds` doc).
  **[Fixed]**. A nit fix doesn't reopen the round.
- `lobby.ts` is a new file, but it holds code moved from files in the round-1 diff, so the
  delta-only rule applied rather than a full round.
- **Package A review done: 2 rounds; 14 fixed, 3 verified, 1 deferred to B6, 7 simplify items
  skipped.**

### Package B, round 1 (Substantial: code-review high, arch-reviewer opus, security-reviewer, simplify)
Snapshot of the reviewed state: `36d7476` (a commit object from a temporary index, since `git stash
create` refused the intent-to-add entries). Arch and security reviewed the snapshot; code-review and
simplify ran after the Chrome-pass fixes, so they saw those too.

- **security**: no findings.
- **[Fixed] Duplicate `Who`** (arch zones.tsx:25): one interface, exported by `Contribution.tsx`.
- **[Fixed] The rest label's rule written twice** (arch Contribution/SessionShares; simplify; altitude 1):
  `carryRest(mode, friends, drawn)` holds the rule; each panel passes whether *its* data draws a rest
  (shares for Contribution, thirds for the touches panel). Per-panel by design: each names the grey
  end it draws. Unit tests for `drawn`.
- **[Verified, no fix needed] 760px goal map cap on the recap** (arch question): kept, see the notes.
- **[Fixed] Comment and doc nits** (arch): friends.ts header wrap, thirds.ts header (neutral),
  PROJECT_INDEX descriptions, the map line wrap, SessionShares' comment.
- **[Verified, no fix needed] `OTHER_PITCH` beside `shared/playlists.ts`** (arch; code-review 4;
  altitude 5): playlist groups don't encode the arena (Ranked Hoops is "ranked"), so a flag would add
  a field to the shared map for 7 ids; the list sits beside its only use with a test. Having the
  server null thirds off-pitch would change package A's stored data: not now.
- **[Fixed] By playlist rows copied between Friends and the recap** (arch; B1's "move, don't copy"):
  `components/PlaylistRecords.tsx`; `recordLabel` moved beside `recordText` in `logic/friends.ts`.
- **[Fixed] Dropped 320px guard** (arch recap.spec): the record's `nowrap` is asserted again.
- **[Fixed] Touches row said "none" with no touch data** (code-review 1): "no touch data yet" when
  `touchMatches === 0`.
- **[Fixed] Rounded segments didn't add up to 100** (code-review 2, 3): `wholeShares` in
  `logic/format.ts` (largest remainder, ties to the earlier) drives `carryShares` and `thirdPcts`, so
  bars fill and the rest's label matches its width; the rest is no longer `flex: 1`. Hovers take the
  segment's own percent. TDD in `format.test.ts`, `friends.test.ts`, `thirds.test.ts`.
- **[Fixed] Hand-written sums of thirds** (code-review 5; simplify): `touchesOf`.
- **[Fixed] The match page's count called "their touches"** (code-review 6): "the touches split",
  since a touch with no team isn't in the thirds (none in 57,800 real hits, per A1).
- **[Fixed] A friend's raw id as a fallback name** (code-review 7): "Friend". Dropping them would
  misalign the server's per-friend arrays.
- **[Fixed] `.note` copied in 4 stylesheets** (code-review 8; simplify): `TouchThirds` renders its
  note from `children` with the shared `.note`; the recap and match page copies went.
- **[Fixed] A file path in BarPct's comment** (code-review 9).
- **simplify** (4 angles; efficiency found nothing):
  - [Fixed] even share recomputed: `evenShare(mode)`; `carryShares` no longer takes the mode.
  - [Fixed] `${p}%` written by hand: `pctText` (labels, titles, `winPctText`, By playlist).
  - [Fixed] Contribution's `Bar` index arithmetic: one segments list drives bars, hovers and label.
  - [Fixed] `NO_THIRDS`, and `sessionThirdRows` typed as `ThirdRow[]` without casts.
  - [Fixed] stale `OTHERS` comment.
  - [Verified, no fix needed] two `Mode` types: one source. The web type is read off the response
    schema, which is `z.enum(MODE_ORDER)` from `shared/lobby.ts`.
  - Skipped: tone shades as CSS variables per `data-tone` (a restyle with no behaviour gain);
    "you / either of you / any of you" back into `sideCopy` (Contribution is its only user, and the
    recap has no `sideCopy`); `Who` in a component file; `WlBar`'s `w + l`; the Friends adapter
    around `PlaylistRecords` (it only renames `label`).
- Check 1,790 passed; e2e 115 passed.

### Package B, round 2 (delta `git diff 36d7476`: correctness-reviewer, arch-reviewer sonnet, security-reviewer)
- Security found nothing; correctness and arch confirm every [Fixed] entry closed with no regressions.
- 6 nits, all **[Fixed]**; a nit fix doesn't reopen the round:
  - `carryShares` was a one-line alias of `wholeShares`: removed, its cases folded into `format.test.ts`.
  - `carryRest`'s `drawn` is required, so a caller can't forget it.
  - `thirdPcts`' cast gets a one-line reason.
  - `Segment.isMe` instead of matching the key "you".
  - BarPct's comment reflowed and made plain.
  - The match page note: "with their total at the end".
- Check 1,790 passed; e2e 115 passed.
- **Package B review done: 2 rounds; 23 fixed, 3 verified, 5 simplify items skipped, nothing deferred.**
