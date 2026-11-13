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
| → | **Ship to friends** | | |
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
- Controls drift first, then icons. Animations are dropped for now (decided 2026-11-13).
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
