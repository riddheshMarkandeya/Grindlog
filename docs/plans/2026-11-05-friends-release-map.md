# Grindlog: friends release map

## Destination
Grindlog in the hands of a couple of friends: installable without dev tools, with a real name, icon,
docs and an update path. Polish comes after their feedback, not before.

## Notes
- Source list: `notes.md`. The order was agreed with the user on 2026-11-05.
- Friend feedback, not guesses, should drive polish and the guided tour. That's why they come after
  shipping.
- Take the first step still open. When one finishes, update its status here.

## Steps
| # | Step | Status | Plan or next action |
|---|---|---|---|
| 1 | Pre-friends backlog fixes | Done (`4531ee4`) | `docs/reviews/2026-11-05-pre-friends-fixes.md`. The goal-map orientation was checked against a replay on 2026-11-09. |
| 2 | Name and app icon | Done | `docs/plans/2026-11-05-name-and-icon.md`. |
| 3 | Task Manager names | Done | Section below. |
| 4 | Distribution | Done (2026-11-12) | Design in `docs/plans/2026-11-06-distribution-map.md`; seven work packages, the last proved by `docs/plans/2026-11-12-wp7-proof-before-friends.md`. v0.1.1 is published; the next tag is v0.1.3. |
| 5 | Docs | Done (2026-11-12) | README, LICENSE (MIT), CHANGELOG, CONTRIBUTING and THIRD_PARTY_NOTICES at the repo root; the exes and installer carry the copyright. |
| → | **Ship to friends** | 0.1.3 published (2026-11-13) | `3ca96d7`. Own install updated itself 0.1.1 → 0.1.3, and an open dashboard tab reloaded on its own with no Ctrl+F5. CI's first run timed out 3 tests on a slow runner (same code passed for 0.1.1); a re-run passed. Left: send friends the link. |
| 6 | Post-feedback UI polish | Open | `/prototype`, after feedback. |

### 3. Task Manager names
- The processes showed as "Bun" because the exes carried Bun's version info. `compileArgs` in
  `scripts/autostart.ts` now sets it, and the exes are `grindlog.exe` and `grindlog-supervisor.exe`.
  Task Manager's Processes tab shows `--windows-description`; `--windows-title` is the product name.
- Bun's values remain in two fields with no effect on Task Manager: `InternalName` is `bun`, and
  `LegalCopyright` is Bun's licensing URL. No flag sets `InternalName`. `OriginalFilename` is empty.
- Later: rcedit sets `InternalName` (step 4), and `--windows-copyright` sets `LegalCopyright` to
  `COPYRIGHT` from `scripts/build-exe.ts` (step 5); the release smoke run checks both.

### 4. Distribution
- Installer, and a tray app: status, Stats API ini setup, open the dashboard.
- GitHub Actions semver releases. They build on a Windows runner, because the `--windows-*` flags need
  a Windows host, except `--windows-hide-console`. `compileArgs` adds `.0` to `package.json`'s `version`,
  so a prerelease form needs handling there.
- Update path. Suggested: an update-available notice in v1.0, auto-update in v1.1.
- Code signing (`/research`).
- Folds in from `BACKLOG.md`: the install exe-replace bug, supervisor orphan, antivirus backup rename
  retry, no-data toast, memory footprint, the WP3b autostart check, and the rest of the internal rename
  to grindlog.

### 5. Docs
- README, LICENSE (MIT, decided 2026-11-12), CHANGELOG, CONTRIBUTING (including AI agents), and
  THIRD_PARTY_NOTICES, which the installer puts next to the app with LICENSE.
- CHANGELOG revisited on 2026-11-12: it was planned "from v1.0.0", but it starts at 0.1.x. Friends get
  0.1.3, and the release notes (`docs/releasing.md` step 6) need a source before 1.0.0.
- `--windows-copyright` is set in `compileArgs`, so the exes no longer carry Bun's licensing URL.

### 6. Post-feedback UI polish
- Icons are done (`37fdb91`, `docs/plans/2026-11-16-icons.md`), taken before controls drift at the user's choice on
  2026-11-16.
- Order from here, set by the user on 2026-11-16 after friends' feedback (no confusion reported, two feature asks):
  1. **Contribution stats** (next): one design covering both asks. (a) A per-session split of you vs your
     team (goals, saves, assists, score…), perhaps per match too, fair across 2v2/3v3, with friends broken out
     when filtered. (b) Touches split by field zone for you, teammates and maybe opponents. The data is already
     stored (every player's stats per match; every hit with its ball position, kept past raw thinning).
     Process: `/grill-me`, then `/prototype` (with and without repeated stats), then `/wayfinder` if it spans
     sessions. Grilled 2026-11-16, decided:
     - "Contribution" replaces "Who carries": the Friends panel (mode switch, even-share tick, team-switch
       matches left out) is renamed and reused on the Recap session, defaulting to the most-played mode. The
       Friends per-match table is renamed too.
     - Rows: Score, Goals, Assists, Saves, MVPs, plus Shots and Touches. Counted events show raw and %
       (`12 of 31 · 39%`); Score and Touches show % only.
     - You vs the rest of your team; friends get their own colour only when selected in the teammate filter.
     - Per match: no panel (the scoreboard has the numbers); one prototype variant adds your share to it.
     - Recap placement by prototype variants: after "Where the goals came from", beside "Per game", or a third
       column in that row; with and without the per-match repetition.
     - Zones: thirds from your own goal, your team vs theirs as totals; per session and per match, Friends
       only if it proves worth it. A logic check on real matches comes after the contribution prototype and
       decides whether zones join it or are dropped.
     - Recap page settled by prototype 2026-11-16 (branch `prototype/contribution`, variant D):
       - Per game keeps its own row. Below it: "Where the goals came from" at ~3/5 width with Scored and
         Conceded side by side under the legend, and one note line ("You scored x of the team's y." plus the
         close/long definition). Right column: By playlist as the Friends win/loss bars (no goals/g; hidden
         with one playlist), then Contribution, then "Where the touches were". Extras and Highlights stay
         full width below (moving either up was tried and held off).
       - Contribution: % inside the bars, no raw column; hovering a segment shows its own numbers
         (`Teammate · 26 of 30 · 87%`), Score and Touches too. Rejected: placements after the goal map,
         beside Per game, or as a third column (A/B/C of round 1).
       - "Where the touches were": one stacked defence/midfield/attack bar per row (You, filtered
         friends, Teammate(s), Opponents); legend squares split diagonally blue/orange per zone shade.
         Driven by Contribution's mode picker (one picker, as on Friends). Rejected: who-had-the-ball-per-
         third bands and a people × thirds grid.
       - Labels: "Teammates" (or "Teammate" when one) replaces "Others"/"2nd teammate"; "Opponents"
         replaces "Their team"; on Friends too.
       - Both panels use our counted touches, not the game's: across 1,294 player-matches ours is 0.97× the
         game's (median), your team share 45.1% vs 45.0%, per-match share gap median 1.7 pts. No note needed.
       - Zone check (27 sessions): your touches lean defensive (36–51% vs teammates ~35%); team vs
         opponents differs by a few points and tracks bad sessions (1–9: 46% defence). A 1-match session
         is noise, so the real build needs a sample note or minimum.
     - Per match settled by prototype 2026-11-16 (variant M1): "Where the touches were" below the scoreboard,
       one bar per player (your team first, you on top), raw touch count at the end, no percentages
       under it. The goal map below keeps today's you/teammate/conceded marks, with Scored and Conceded
       side by side as on the recap. Each goal's hover names the scorer and assister. The match detail
       already has the names; a session view would need them added. Long names truncate with an
       ellipsis and show in full on hover. Rejected: touch dots per player on the goal map (busy, no
       value), a touch heatmap, goal marks with a colour per player (too many colours against the
       recap page) or with initials, ball-path arrows, and percentages per match.
     - Build scope agreed 2026-11-16: the stored goal list carries `scorerName`/`assisterName` (one join),
       so every goal map's hover names people, the recap's included. The shared Contribution panel
       gains Shots and Touches on Friends too (the carry data adds them). Friends gets no "Where the
       touches were" for now: long-run thirds flatten out; you vs a friend without opponents could
       come later.
  2. **Animations and transitions exploration** (placeholder): dropped on 2026-11-13, reopened by the user
     2026-11-16 as an exploration step. Scope is still open.
  3. **Controls drift**, last.
- Icons: the look was picked by a prototype on 2026-11-13 (branch `prototype/icons`, `c92c5c7`, never merged). The
  build is its own planned package here, not before 0.1.3. Picked:
  - Lucide, icon + text, on nav, action buttons, stat cards and tiles, match rows and markers. The Settings page
    and the Highlights cards stay text.
  - Goal is Phosphor's regular `SoccerBall`, because Lucide has no soccer ball (Phosphor is MIT; add it to
    THIRD_PARTY_NOTICES with Lucide). Crossbar hits and Aerial touches are hand-drawn on Lucide's grid and stroke.
  - The game's statfeed PNGs are replaced, so their THIRD_PARTY_NOTICES entry goes.
  - The stood-out mark stays "!": a trend arrow read as a second up/down arrow next to ▲/▼. The share card keeps
    plain tiles (icons looked too busy) and gets a trend arrow on its stood-out line.
  - Avg boost is a half-full battery and Empty tank an empty one. Stat card labels align to the top, so a
    two-line label keeps its icon level with the row.
  - Rejected: Phosphor and Tabler as the set, the hand-made statfeed set, and icon-only density.
- A guided tour only if friends got lost.
- Also: data-line colour, a colour-pair setting, themes, playful touches.
