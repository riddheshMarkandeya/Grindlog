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
| A | Close games | Open | **Trends**: a "Close games" section that follows the period, playlist and With filters. It shows the 1-goal record (forfeits left out), OT record, scored-first win %, comebacks and blown leads (trailing or leading at any point, plus the biggest comeback, e.g. "won from 0–3"), and forfeit wins and losses as their own line. **Recap**: match-card badges (OT, comeback with the deficit, blown lead, forfeit) and remark triggers for comebacks, blown leads and OT, plus joke "Probably lag" excuse lines on blown leads, close losses and OT losses. The lag lines are copy only: the Stats API has no network data, so nothing is detected. Prototype first. |
| B | Tilt | Open | **Trends**: a "Tilt" section below Close games. It shows win % by session game number (1–3 / 4–6 / 7–9 / 10+) and after a win / 1 loss / 2+ losses in a row, each bucket with its match count. Solo vs friends comes from the existing With filter; no side-by-side panel. Game number and streaks count every match in the session, whatever the filter, since a session is time at the PC. No tilt line on the recap. Prototype first. |
| C | Goal clock | Open | A recorded rule: a goal's clock time is the last `ClockUpdatedSeconds` before its GoalScored (exact to the second; thinning only touches UpdateStates, so old matches have it too). It adds a column and a recompute through `release-recompute`. **Match page**: a goal timeline between the scoreboard and "Where the goals came from" (prototype several designs on real matches). **Trends**: late goals (last 30 s) scored and conceded, and goals conceded within ~15 s of scoring, as lines in Close games. **Recap**: a late-winner badge. |
