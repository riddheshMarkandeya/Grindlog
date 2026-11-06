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
| 1 | Pre-friends backlog fixes | Done (`4531ee4`) | `docs/reviews/2026-11-05-pre-friends-fixes.md`. The goal-map orientation check by eye is still the user's. |
| 2 | Name and app icon | Done | `docs/plans/2026-11-05-name-and-icon.md`. Start menu and tab icon checks by eye are still the user's. |
| 3 | Task Manager names | Next | No plan yet. |
| 4 | Distribution | Open | `/wayfinder`, multi-session. |
| 5 | Docs | Open | No plan yet. |
| → | **Ship to friends** | | |
| 6 | Post-feedback UI polish | Open | `/prototype`, after feedback. |

### 3. Task Manager names
- The processes show as "bun". Likely `bun build --compile --windows-title/-description/-icon/-version`
  in `scripts/autostart.ts`; verify the flags.
- Includes renaming the exes (`rltracker*.exe`) and using `src/web/public/favicon.ico` as
  `--windows-icon`.

### 4. Distribution
- Installer, and a tray app: status, Stats API ini setup, open the dashboard.
- GitHub Actions semver releases.
- Update path. Suggested: an update-available notice in v1.0, auto-update in v1.1.
- Code signing (`/research`).
- Folds in from `BACKLOG.md`: the install exe-replace bug, supervisor orphan, antivirus backup rename
  retry, no-data toast, memory footprint, the WP3b autostart check, and the rest of the internal rename
  to grindlog.

### 5. Docs
- README, LICENSE (decide early), CHANGELOG (from v1.0.0), CONTRIBUTING (including AI agents).

### 6. Post-feedback UI polish
- Controls drift first, then icons and animations.
- A guided tour only if friends got lost.
- Also: data-line colour, a colour-pair setting, themes, playful touches.
