# Grindlog: analytics map

## Destination
New analytics that answer questions the current pages don't: how you do in close games, whether you tilt over a
long session or after losses, and when goals happen in a match.

## Notes
- Picked from the analytics brainstorm with the user in a grill-me on 2026-11-23. Order is A → B → C.
- Take the first step still open. When a step finishes, update its status here.
- **Every step's UI is prototyped before it's built** (the user's rule). In step C, the clock rule is backend
  only, so it can be built while the timeline prototype is still being chosen.
- Facts from the 2026-11-23 data (350 matches, 30 sessions, 1,931 goals): 157 one-goal games, 57 in overtime,
  83 ended early (forfeits). 22 sessions reach game 10 and 7 reach game 15. Only 12 opponents appear in 2+
  matches, and 2 appear in 3.
- Dropped: **nemesis**, because random matchmaking leaves almost no repeat opponents (see above). **Scoreboard rank**
  and **top-on-team %** were dropped because they repeat win %, MVP and score share.
- Deferred to BACKLOG: a period-level concede heatmap (the recap's map already shows scored and conceded per
  session), and an in-session tilt nudge (only once step B's chart shows a real drop).
- Nothing new goes on the recap overview: these stats need many matches. Single moments do show there, as
  match-card badges and remarks, each shipped with the step that provides its data.
- All of A's data is already stored: `match_goals.idx` and `team_num` give the goal order, plus
  `matches.overtime` and `end_kind`. Only read-side definitions are needed.

## Steps
| # | Step | Status | Plan or next action |
|---|---|---|---|
| A | Clutch | Done | Prototyped over three rounds on real data (`98500cd` on `prototype/close-games`, not merged). Verdict (2026-11-23): **Trends** gets a "Clutch" section that follows the period, playlist and With filters. Counted: casual, ranked (extras included) and tournament playlists; every match with a team and a win or loss, forfeits and left matches included. Tiles: 1-goal games (total record, "N–N without OT" in the note), overtime, scored first, conceded first, comebacks (a win after 2+ down) and blown leads (a loss after 2+ up), forfeits on their own. A ladder gives win % by the biggest deficit (1, 2, 3+ down) and the biggest lead (1, 2, 3+ up); the best comeback and worst collapse link to their match from the 3+ rung (the 2 rung when the biggest swing is 2). Goal order uses a match's goals by `idx` only when the goals per team equal the final score; a joined match or the one flagged 7–3/8–2 match is left out of goal-order stats (no new flag: the existing checks and `joined` cover it). A match whose result contradicts its final score (a forfeit win at 0–7, found in real data) is left out of the swing stats. **Recap**: a story line on match cards (`from 1–4`, `led 3–0`, `OT`, `FF`) and remarks for comebacks, blown leads, 3+ close losses a session (1-goal losses without OT, played to the end) and OT, with joke "Probably lag" lines (copy only: the Stats API has no network data). Plan: this session's plan, decisions in the commit bodies. |
| B | Tilt | Open | **Trends**: a "Tilt" section below Clutch. It shows win % by session game number (1–3 / 4–6 / 7–9 / 10+) and after a win / 1 loss / 2+ losses in a row, each bucket with its match count. Solo vs friends comes from the existing With filter; no side-by-side panel. Game number and streaks count every match in the session, whatever the filter, since a session is time at the PC. No tilt line on the recap. Prototype first. |
| C | Goal clock | Open | A recorded rule: a goal's clock time is the last `ClockUpdatedSeconds` before its GoalScored (exact to the second; thinning only touches UpdateStates, so old matches have it too). It adds a column and a recompute through `release-recompute`. **Match page**: a goal timeline between the scoreboard and "Where the goals came from" (prototype several designs on real matches). **Trends**: late goals (last 30 s) scored and conceded, and goals conceded within ~15 s of scoring, as lines in Clutch. **Recap**: a late-winner badge. |
