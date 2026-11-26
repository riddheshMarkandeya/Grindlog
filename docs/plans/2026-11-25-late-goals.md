# Late goals in Clutch and the recap's late-winner badge (analytics map step C, part 3)

## Context
Row C of `docs/plans/2026-11-23-analytics-map.md` still owes two things. **Trends**: lines in Clutch for late goals
(the last 30 s) scored and conceded, and for goals conceded within ~15 s of scoring. **Recap**: a late-winner badge
on match cards. Parts 1–2 stored the data: every goal's `clock_seconds` / `clock_overtime` (the time left in
regulation, or the time played in overtime). Everything here is read-side: no new column, migration or recompute.
The map's rule (and the `analytics-plan` memory) says every UI gets a prototype on real data first.

Real data (2026-11-25, read-only): 2,061 goals, all with a clock, 0 matches with `goals_clocked` /
`clock_overtime_flagged`. 173 regulation goals came in the last 30 s, 13 of them at 0:00. 32 of the 354 deciding
goals came in the last 30 s (both teams' wins; 59 were in overtime). Of 819 goals the other team answered, 210
were answered within 15 s of regulation clock (139 within 10 s, 280 within 20 s).

User's decisions (2026-11-25):
- The badge goes on **wins and losses**: your late winner gets the up tone, theirs gets the down tone.
- **Add the mirror line**, "scored within 15 s of conceding", next to "conceded within 15 s of scoring", so each
  reads against the other.
- **Prototype first** (Part 1), then build the verdict (Part 2).

## Definitions (fixed now, shared by the prototype and the build)
All of these live in `src/shared/clutch.ts`, beside `SWING_MIN_GOALS`.
- `LATE_SECONDS = 30`: a **late goal** is a regulation goal (`overtime: false`) whose clock reading is
  ≤ 30. A reading is the last whole second before the goal, so ≤ 30 means 30 s or less left. Overtime goals
  are never late. Every overtime goal wins the match, and the Overtime tile already covers them.
- `ANSWER_SECONDS = 15`: a goal is **answered** when the next goal (by `idx`) is the other team's, scored
  ≤ 15 s of game clock later. The gap is computed without the regulation length:
  - both goals in regulation: `a.s − b.s`;
  - regulation then overtime: `a.s + b.s`;
  - both in overtime: `b.s − a.s`.

  "Conceded within 15 s of scoring" is your goals answered, out of all your goals. The mirror is their goals
  answered by you, out of all their goals. Both lines use the same denominator rule.
- ~~**Late-line share**~~: dropped by the verdict (the tile shows the counts only).
- **Late winners** (the tile): W = matches with your late winner, L = matches with theirs; the value is the win %.
- **Late winner**: in a match with a win or loss, the **deciding goal** is the winner's (loser's final + 1)-th
  goal: the go-ahead goal the winner never gave back. It's a late winner when it's late (above). `mine` is true
  in a win. There's no deciding goal (so `lateWinner: null`) when:
  - the final score is tied (a forfeit win at 2–2: 1 match in real data);
  - `endKind` is `left`: the score is wherever you stopped watching, matching `close_losses`, which needs
    `completed`. The badge needs `completed` or `early_end`.

  Left matches still feed the late and answered counts, because their per-goal facts are real.
- **Which matches count**, two gates:
  1. **Clock-checked**: the match is a counted Clutch match with a valid goal order (`order !== null`), and every
     goal has a clock. Its overtime flags must also be consistent:
     - no overtime-clocked goal when `match.overtime` is false;
     - no regulation goal after an overtime one;
     - when `match.overtime` is true and `endKind` is `completed`, the last goal is overtime-clocked.

     These rules stand in for `clock_overtime_flagged`, which `MyMatch` can't see; it only has `checkFailed`.
     Real data has 0 matches that break them.
  2. **Late winner** also needs `swings` true, so a forfeit win at 0–7 has no "deciding goal".

  `skippedClock` counts only the matches that have an order but fail the clock rules, so it doesn't overlap
  `skippedOrder`. It's logged like `skippedOrder`.

## Part 1: prototype (throwaway)
Invoke the `prototype` skill (UI variants), and also `ui-implementation-guidelines`.
- Work on branch `prototype/late-goals` off master; it is never merged, and its commit hash goes in the map
  as in steps A and B.
- It runs against the real dev data (`bun run start` + `bun run web:dev`), with a variant switcher.
- **Clutch lines**, 3 or so variants under the ladders panel:
  - (a) a compact "Goal clock" panel with three rows: late scored vs conceded, conceded within 15 s, scored
    within 15 s, each a count and a % of goals;
  - (b) two extra tiles in the existing row;
  - (c) paired bars, like the WlBar rows: late scored | conceded, answered-you | answered-them.
- **Badge**, 2–3 variants on the recap cards:
  - (a) a story-line part ("late winner 0:12" / "late loss 0:12", or whatever wording the prototype shows);
  - (b) a small clock icon, like the MVP icon;
  - (c) both.
- **Verdict**: the user picks. Record it in row C of the map, with the prototype commit, and fold it into Part 2
  below before building. If the verdict changes a definition, update the Definitions section first.

### Verdict (2026-11-25, `4325383` on `prototype/late-goals`, not merged)
- **Trends**: (b) tiles, merged into the existing Clutch row and grouped by theme:
  1-goal games, Overtime, **Late winners**, **Late goals**, Scored first, Conceded first, **Scored right back**,
  **Conceded right back**, Comebacks, Blown leads, Forfeits.

  | Tile | Value | Note | Icon |
  |---|---|---|---|
  | Late winners | win % of matches with a late deciding goal (W = yours, L = theirs) | "won 10–10 when decided in the last 30 s" | alarm clock (new `lateWinner`) |
  | Late goals | "47–48" (for–against) | "for–against in the last 30 s" | `time` |
  | Scored right back | % of their goals you answered | "within 15 s, after 59 of their 607 goals" | `fastest` |
  | Conceded right back | % of your goals they answered | "within 15 s, after 66 of your 630 goals" | undo arrow (new `concededBack`) |

  Each note fits the tile's 2 lines (≈ 44 characters). The late-goal **share** (of regulation goals) is dropped:
  the note had no room for it and it added little beside the counts. Late winners shows a win % like 1-goal
  games and Overtime.
- **Intro**: opens "How your team does when it's tight or the lead swings: every number here counts your team's
  goals and results, not just yours." and gains "Late means the last 30 s of regular match time; overtime goals
  are never late."
- **Icons**: 1-goal games, Scored first and Conceded first get Clutch-only keys (`oneGoal` scale, `scoredFirst`
  circled up arrow, `concededFirst` circled down arrow); `score`, `goal` and `save` stay as they are elsewhere.
- **Recap**: (b) the clock icon only, bottom-right of the card: up tone for your late winner, down for theirs.
  The time is in its tooltip ("Late winner with 0:17 left") and in the card's screen-reader label. The story
  text and its tone are unchanged.
- Rejected: the panel (a) and paired bars (c) for the lines; story text (a, c) for the badge, which was cut off
  beside a comeback ("from 0–2, late win…").

## Part 2: build (after the verdict)
TDD per `tdd-live-code-carveout`: full red-green for the pure logic, and a real-browser check for the UI.
1. **`src/shared/clutch.ts`**:
   - `ClutchGoal` gains a required `clock: { seconds: number; overtime: boolean } | null`. Server `Goal` and the
     web `Goal` already carry it, so `pages.ts` and `triggers.ts` need no changes. Two test helpers do need a
     clock argument: `goals()` in `src/shared/clutch.test.ts` and `goalsOf` in
     `src/server/remarks/triggers.test.ts`.
   - Add `LATE_SECONDS`, `ANSWER_SECONDS` and a pure `secondsBetween(a, b)`.
   - Pull `goalOrder`'s filter-by-guid-and-sort out into a `matchGoals(m, goals)` helper. `goalOrder`,
     `clockChecked` and the deciding-goal code all call it, because `matchClutch` gets a whole session's goals
     from `Overview.tsx` and `triggers.ts`.
   - Add `clockChecked(m, ordered goals)`.
   - `MatchClutch` gains `lateWinner: { mine: boolean; seconds: number } | null`.
   - `ClutchStats` gains:
     `clock: { matches; lateScored; lateConceded; yourGoals; theirGoals; answeredByThem; answeredByYou;
     lateWinners: WL }` and `skippedClock`. (Verdict: no regulation-goal denominators, since the share is dropped.)
   - The new code reuses `goalOrder`'s per-match ordering and the existing `byMatch` grouping.
2. **`src/shared/schemas/responses.ts`**: add the `clock` object and `skippedClock` to `clutchSchema` (it already
   has `satisfies z.ZodType<ClutchStats>`, so the types catch any drift).
3. **`src/server/api/pages.ts` `clutch()`**: the `clutch` log line gains `clockMatches`, `skippedClock`,
   `lateScored`, `lateConceded` and up to 5 skipped-clock guids. Those answer: how many matches had clock stats,
   which were dropped and why, and whether the counts look plausible against the SQL figures above.
4. **Web text**:
   - `src/web/logic/clutch.ts` `clutchTiles` gains the four tiles in the verdict's order, with its wording
     (– and no note when the denominator is 0), and the three Clutch-only icon keys.
   - `src/web/logic/icons.ts` + `src/web/components/Icon.tsx`: `lateWinner` (AlarmClock), `concededBack`
     (Undo2), `oneGoal` (Scale), `scoredFirst` (CircleArrowUp), `concededFirst` (CircleArrowDown).
   - `src/web/pages/trends/Clutch.tsx`: `INTRO` gets the verdict's two sentences. No layout change.
5. **Recap badge** (verdict: icon):
   - A new `lateWinnerMark(c)` beside `clutchStory` in `src/web/logic/recap.ts` returns
     `{ title, label, tone } | null`: title "Late winner with 0:17 left" / "Late loss with 0:28 left", label
     "late winner with 17 seconds left" / "late loss with 28 seconds left", tone up when `mine`, else down. Null for
     a null `MatchClutch` or `lateWinner`.
   - `clutchStory` and its tone stay as they are (the icon carries its own tone).
   - `Overview.tsx` `MatchCards` renders the clock icon (bottom-right, `aria-hidden`, `title`) and passes the
     story label and the mark's label, joined, to `matchLabel`; the story text gets right padding when the icon
     is there, so it doesn't run under it.
6. **Rules registry** (`src/server/rules/registry.ts`): add `clutch_late_goals` (with `LATE_SECONDS` and
   `ANSWER_SECONDS`) and `clutch_late_winner`, both `applied: "read"`, `refs: [ANALYTICS_MAP]`, with the real-data
   figures as evidence. Both get
   `checks: ["goals_clocked", "clock_overtime_flagged", "goals_per_team_equal_score"]`. Then run `bun run definitions` to regenerate `docs/definitions.md` and the constant pins.
7. **Docs**: `CHANGELOG.md` Unreleased › Added (both features); the map's row C → Done with the verdict;
   `PROJECT_INDEX.md` line for `shared/clutch.ts` (it now covers the goal clock and late winners).

## Tests
- `src/shared/clutch.test.ts`:
  - late goals: 30 counts, 31 doesn't, 0:00 counts, overtime never counts;
  - `secondsBetween` for all three clock pairs;
  - answered at exactly 15 s and at 16 s, an answer by your own team (not counted), and the last goal
    (unanswered);
  - mirror denominators;
  - `lateWinners` W/L summed over matches;
  - deciding goal in a win and in a loss: 2–1 late, 3–1 where the deciding goal was early but a late insurance
    goal came after it, an overtime winner (no badge), `swings` false (no badge), a tied-score forfeit win
    (no badge), and a left match (no badge, but its goals still count);
  - `clockChecked` rejections: a null clock, an overtime goal in a non-overtime match, a regulation goal after
    an overtime one, a completed overtime match whose last goal is regulation-clocked, and `order` null (counted
    in `skippedOrder` only, not `skippedClock`);
  - `matchClutch` given two matches' goals (no cross-match leakage).
- `src/web/logic/clutch.test.ts`: the four tiles' text and order, the answered denominators (all goals),
  Late winners as a win %, the new icon keys, and empty states.
- `src/web/logic/recap.test.ts`: `lateWinnerMark` title, label and tone for a win and a loss; null for no
  `lateWinner`; `clutchStory` unchanged by a late winner; `matchLabel` carries the mark's label.
- `src/server/remarks/triggers.test.ts`: the existing remarks still fire once goals carry a clock.
- An `api.test.ts` assertion that the period view carries the `clock` stats (built in `pages.test.ts`, beside the
  existing `clutch()` log test, which drives the same period view).
- An e2e check only if the verdict adds interaction (a link or a toggletip). Otherwise the real-browser check
  is enough.

## Verification
- `bun run check` (typecheck, lint with zero warnings, tests).
- Real dev data: the Trends Clutch totals for "everything / all time" match the SQL figures above, after
  narrowing to your team and the counted playlists. Re-run the read-only query with `me` joined.
- The browser at 1366 and at a narrow width; light/dark themes; reduced motion; a screen-reader label on a
  badged card.
- `bun run e2e` before the review, then `independent-review-pass`.

## Plan review
`plan-reviewer` (opus), 2026-11-25. Every finding was folded in:
1. An overtime golden goal with a mislabelled overtime flag could read as a late winner, because `MyMatch`
   can't see `clock_overtime_flagged`. → Third consistency rule: a completed overtime match's last goal must be
   overtime-clocked (0 real violations). Test added.
2. The deciding goal is undefined in a win with a tied score (1 real match). → `lateWinner: null`, with a test.
3. In a left match the stored score is wherever you stopped watching. → No badge unless `completed` or
   `early_end` (as `close_losses` does); its goals still count toward the lines.
4. `goalsOf` in `triggers.test.ts` also needs a clock. → Listed in step 1.
5. `matchClutch` gets a whole session's goals. → `matchGoals` helper extracted, with a cross-match test.
6. `skippedClock` overlapped `skippedOrder`. → It now counts only matches that have an order.
7. The late-share denominator was ambiguous. → Regulation goals, pinned in the web tests. (Superseded: the verdict
   dropped the share.)
8. The registry entries had empty `checks`. → The three clock/order checks named.
9. Missing test seams: the tone combination, `matchLabel`, and the remarks with a clock. → Added to Tests.

## Results (2026-11-25)
- `bun run check`: typecheck, lint (0 warnings), 2,174 tests passed (1 skipped). `bun run e2e`: 161 passed.
- Real data (a snapshot of the dev DBs, served on 49101, since the installed dev build holds 49102): Trends,
  everything / all time: 362 counted matches, 361 clock-checked, `skippedClock` 0, `skippedOrder` 1. Late goals
  87–82, Late winners 15–17 (47%), Scored right back 104 of 1,009 (10%), Conceded right back 99 of 996 (10%).
- Independent cross-check (a plain SQL count, not `shared/clutch.ts`): counted playlists, your team, goals per
  team equal to the score, left matches included: late goals 87 scored, 82 conceded, matching the tile.
- Browser: Trends and recap at 1366 and in a 360 px frame (the window wouldn't resize), carbon and slate (no light
  theme ships), no console errors. The 2026-11-21 session badges matches 7 (late winner 0:17, beside "from 0–2"),
  10 and 17 (late losses 0:28, 0:22), each with its label; a flagged card puts the clock left of the flag dot.
  No new motion, so reduced motion has nothing to change.

## Review log
Diff classified Standard (236 non-test, non-doc lines; no high-risk path).

**Round 1** (snapshot `b8a366a`): `/code-review medium`, `arch-reviewer` (opus), `security-reviewer`.
- code-review: a clock that runs backwards gives a negative gap that passes as "answered". [Fixed] `clockChecked`
  rejects it (an unseen shape: 0 in real data; Watch list item added); one stats fixture had a backwards clock and
  was reordered.
- code-review: on a card with no story, the clock covers the end of the playlist name. [Fixed] `.p` gets the same
  padding as `.story` on `.hasLate` cards.
- code-review + arch (q): the card uses `time` (Clock), not `lateWinner` (AlarmClock). [Verified, no fix needed]
  The plain clock is what the user picked on the prototype (`4325383` renders `k="time"`).
- code-review (nit): the right-back note reaches 45 characters near 1,000 answered goals (43 today).
  [Deferred → BACKLOG]
- code-review + arch (nit): `clutchStats` re-runs `matchGoals` and `clockChecked` after `matchClutch`.
  [Verified, no fix needed] Each match has only a few goals; exposing them on `MatchClutch` would widen a type the
  recap uses, for no measurable gain.
- arch (bug): the CHANGELOG described only Conceded right back. [Fixed]
- arch (nits): the `api.test.ts` placement wasn't noted, plan-review item 7 contradicted the verdict, a test comment
  didn't parse, and `lateWinnerMark` capitalised a literal. [Fixed]
- security: no findings.

**Round 2** (delta from `b8a366a`): `correctness-reviewer`, `security-reviewer`. No findings. Review done.
After the fixes: `bun run check` 2,175 passed (1 skipped), lint 0 warnings; `bun run e2e` 160 passed, 1 failed
(`season-file.spec.ts:8`, the known flaky test in BACKLOG), which passed on its own re-run.
