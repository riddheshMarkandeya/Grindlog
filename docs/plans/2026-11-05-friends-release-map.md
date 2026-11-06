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
| 3 | Task Manager names | Done | Section below. Task Manager and Explorer icon checks by eye are still the user's. |
| 4 | Distribution | Next | `/wayfinder`, multi-session. |
| 5 | Docs | Open | No plan yet. |
| → | **Ship to friends** | | |
| 6 | Post-feedback UI polish | Open | `/prototype`, after feedback. |

### 3. Task Manager names
- The processes showed as "Bun" because the exes carried Bun's version info. `compileArgs` in
  `scripts/autostart.ts` now sets it, and the exes are `grindlog.exe` and `grindlog-supervisor.exe`.
  Task Manager's Processes tab shows `--windows-description`; `--windows-title` is the product name.
- Bun's values remain in two fields with no effect on Task Manager: `InternalName` is `bun`, and
  `LegalCopyright` is Bun's licensing URL. No flag sets `InternalName`. `OriginalFilename` is empty.

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
- README, LICENSE (decide early), CHANGELOG (from v1.0.0), CONTRIBUTING (including AI agents).
- Once the licence is picked, set `--windows-copyright` in `compileArgs`: the exes still carry Bun's
  licensing URL in `LegalCopyright`.

### 6. Post-feedback UI polish
- Controls drift first, then icons and animations.
- A guided tour only if friends got lost.
- Also: data-line colour, a colour-pair setting, themes, playful touches.
