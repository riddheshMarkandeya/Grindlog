# Friends release step 2: name (Grindlog) + app icon

## Context
Step 2 of the friends-release queue (memory `work-queue`; source `notes.md:5` "App Icon and possible
new name"). The name and icon gate everything that ships after it: exe names (step 3), installer and
tray (step 4), repo and README (step 5). "RL Tracker" is generic, close to existing RL stats sites, and
leans on the Rocket League / RL trademark. No icon exists yet (`src/web/index.html:8` is an empty
favicon placeholder).

## Decisions (grill, 2026-11-05)
- **Name: Grindlog**, written "Grindlog" in UI text and `grindlog` in ids. Clash check: an iOS
  workout app and a poker notes app use "GrindLog"; neither is in gaming, and no GitHub project has
  the name. Accepted as low risk.
- **Icon: SVG designed in-repo.** A prototype shows several directions and the user picks one; the
  .ico and PNGs are generated from that SVG.
  - The user's directions: G monogram, session bars, split blue/orange G, log + ball.
  - The user also asked for more ideas, including Rocket League ones: boost pad, ball with hex
    panels, goal frame, car with boost trail, boost meter.
- **Header: icon + "Grindlog" text.** The share-card footer gets the same pair.
- **Step 2 scope:** name, icon assets, and every place a user sees the name (dashboard, toast, CLI
  messages, task description, Start-menu shortcut).
- **Internal ids are renamed later:**
  - Step 3: exe names (`rltracker*.exe`).
  - Step 4: the data dir `%LOCALAPPDATA%\RLTracker` and task `RLTracker`, with installer migration.
    The `RLTRACKER_*` env vars, `X-RLTracker-*` headers and package name go with them.
  - Repo: the user renames the GitHub repo themselves; GitHub redirects the old URL.

## Steps
0. Copy this plan to `docs/plans/2026-11-05-name-and-icon.md`.
1. **Icon prototype** (`prototype` skill, scratch files only, not committed). One HTML page with
   switchable variants: the 4 picked directions plus about 5 RL ideas. Each variant is shown:
   - at 16, 32, 48 and 256 px, on the three dark themes (carbon, slate, oled) and on a light and a
     dark browser tab strip (the favicon's real backgrounds);
   - in a mock header next to "Grindlog";
   - using the blue `#3987e5` / orange `#d95926` tokens from `src/web/styles/tokens.css`.

   Glyphs are hand-drawn paths: no font outlines and no game logos or car models. **Gate: the user
   picks one (iterating if needed) before step 2.** If the master blurs at 16 px, a hand-tuned 16 px
   variant is drawn too.
2. **Assets.**
   - The chosen master goes to `src/web/public/icon.svg`. Vite copies `public/` into the build root,
     so it also lands in `<dataDir>\bin\web`.
   - If the prototype shows the master blurs at small sizes, a hand-tuned
     `scripts/icon-sources/icon-small.svg` is added, used for 16 and 24 px. Otherwise every size
     comes from `icon.svg`.
   - New `scripts/make-icons.ts` (`bun run icons`) renders PNGs at 16/24/32/48/64/128/256 with
     Playwright (already a devDependency, so no new deps).
     - It launches with `chromium.launch({ channel: "chrome" })`, the installed Chrome the e2e
       config already uses, so nothing is downloaded.
     - Each size gets its own page with a viewport of exactly that size, `deviceScaleFactor: 1`, a
       transparent body and `screenshot({ omitBackground: true })`.
     - Fire the launch once early under Bun. If it doesn't work under Bun, run the script with node.
   - The script packs the PNGs into `src/web/public/favicon.ico` as a PNG-in-ICO file, and the
     output is committed.
   - The pure `packIco(pngs)` gets TDD unit tests:
     - the header (reserved 0, type 1, count);
     - each directory entry stores 256 as byte 0, planes 1 and bitcount 32;
     - the first offset is 6 + 16·n, and later offsets add up the previous sizes.
   - The script logs each file written. When Chrome is missing, it fails with a message saying Chrome
     wasn't found.
   - Steps 3 and 4 reuse `favicon.ico` for `--windows-icon` and the tray.
3. **Dashboard** (load `ui-implementation-guidelines`).
   - `index.html`: title "Grindlog"; replace the `data:,` placeholder with `/favicon.ico` and
     `/icon.svg` (type `image/svg+xml`) links.
   - Header (`src/web/components/Header.tsx:15`): `<img src="/icon.svg" alt="">` + "Grindlog", sized
     in `Header.module.css`.
   - Share card footer (`src/web/pages/recap/ShareCard.tsx:199`): the same pair, with the same `<img>`
     so `icon.svg` stays the single source. html-to-image embeds a same-origin svg. It's the card's
     first `<img>`, though, and a failed fetch poisons html-to-image's cache until reload. So
     `test/e2e/share.spec.ts` gets new assertions:
     - the card's `img` has `naturalWidth > 0`;
     - an export logs no `share/export_failed` (the existing `warnings()` helper).
4. **Server and CLI strings.**
   - Toast title (`src/server/game-watch.ts:62`).
   - Messages in `scripts/stop.ts`, plus its tests in `scripts/stop.test.ts`.
   - Messages and the task `<Description>` in `scripts/autostart.ts`.
   - **Shortcut:**
     - The file becomes `Grindlog.url`.
     - `shortcutFile(url, iconFile)` adds `IconFile=<bin>\web\favicon.ico` and `IconIndex=0`;
       `autostart.test.ts` is updated test-first.
     - Install removes the legacy `RL Tracker.url` (best-effort and logged, like `writeShortcut`).
     - If `<bin>\web\favicon.ico` is missing after the web swap (a failed swap kept the old build),
       install logs that the shortcut will show a generic icon until the next install.
     - Uninstall removes both.
   - Comments mentioning "RL Tracker" in touched code are updated. `TASK_NAME`, the data dir, the exe
     names, the env vars and the headers stay as they are (see Decisions).
5. **Records.**
   - `PROJECT_INDEX.md` and the `CLAUDE.md` title get the new name; historical plans and decisions
     stay as written.
   - BACKLOG item: "Internal rename to grindlog". It lists each id with its step (exes → step 3; data
     dir + task migration, env vars, headers, package name → step 4).
   - Update memory `work-queue`: step 2 done; step 3 includes the exe rename and `favicon.ico`.
6. **Review**: `independent-review-pass` by the actual diff.

## Verification
- `bun run check` (typecheck, lint, vitest), which includes the `packIco`, shortcut and stop tests.
- `bun run e2e`. Shell, recap and share specs must pass. Grep the specs for "RL Tracker" and title
  checks first.
- Real browser on `bun run dev` + `web:dev`:
  - the tab favicon;
  - the header mark and text at desktop and phone width, in carbon, slate and oled;
  - Share → the exported PNG shows the mark and "Grindlog".
- Open the generated `favicon.ico` and check it at 16/32/256.
- Live install (`bun run install-autostart`) touches the user's running install, so ask first. Then
  confirm that the Start menu shows "Grindlog" with the icon, the old "RL Tracker" shortcut is gone,
  and the toast title reads "Grindlog isn't getting data". The toast still appears under "Windows
  PowerShell", because it uses PowerShell's AppUserModelID (`game-watch.ts:64-65`). That's expected,
  not a miss; it changes with the tray app in step 4.

## Outcome
- **Prototype verdict (2026-11-05).** Round 1 showed the 9 directions; the user narrowed to A, B and D and
  asked for variations; **B3 (dim session bars with an orange trend line) was chosen.** The prototype was a
  scratch file as planned, so there is no prototype branch.
- **The master blurs at 16 and 24 px** (compared magnified), so `src/web/assets/icon-small.svg` exists.
  It has no end dot, which isn't legible at that size.
- **Changed from the plan:**
  - `index.html` links `/favicon.ico` only, not also `/icon.svg`: browsers generally prefer an SVG icon, which
    would replace the hand-tuned 16 px drawing in the tab.
  - The PNGs are only packed into `favicon.ico`, not also written as separate files; nothing reads them yet.
  - The share footer keeps the name's case, drops the old uppercase and wide tracking, and is weight 600. It
    keeps its height (a 14 px mark at 11 px text overflowed the stress card by 1 px).
  - Both SVGs live in `src/web/assets` and are imported, not in `public/` and `scripts/icon-sources`, so Vite
    inlines them and the share export fetches nothing (Review log, round 1). This revisits the plan review's
    "inline SVG" rejection, which was about a second copy of the paths; an import has none.
  - The header uses `icon-small.svg`, not the master: at 20 px on a 1x display the master's bars are muddy.
  - "Still in use" now names the exes to end, since Task Manager won't show "Grindlog" until step 3.
  - The master's bars went from the prototype's `#3a3a40` to `#4a4a52`, and the glyph was centred in the tile.
- **Verification status (2026-11-05).**
  - Done: `bun run check` and `bun run e2e` (figures in the Review log). `bun run icons` reproduces the committed
    `favicon.ico` byte for byte, and its frames were viewed magnified.
  - Done on the live install: `Grindlog.url` is the only shortcut of the two, with `IconFile` set; the old one is
    gone; the task description, tab title and header read Grindlog, on all three themes; no icon requests and no
    console errors; no overflow at 320 px. An exported share card shows the mark and the name.
  - The user's to check by eye: the icon in the Start menu and in the browser tab.
  - Not exercised live: the toast title (needs the game running with its Stats API off), a real uninstall (its
    shortcut removal is tested against a temp `APPDATA`) and the missing-Chrome message in `make-icons.ts`.

## Review log
**Round 1** (Standard: about 180 non-test lines, no high-risk paths named). `/code-review medium`,
`arch-reviewer` (opus), `security-reviewer`. Snapshot `f733c22`. Security: no findings.
- **[Fixed]** The share footer's fetched `<img>`: one failed fetch makes every export fail until a reload,
  through html-to-image's cache. The plan accepted this, but never weighed a Vite import. Now inlined; e2e
  asserts a `data:image/svg` src (red first).
- **[Fixed]** The header's master looks muddy at 20 px on 1x (compared by eye). It now uses `icon-small.svg`.
- **[Fixed]** `make-icons.ts` loaded Playwright to test `packIco` (both reviewers). Now a dynamic import.
- **[Fixed]** Shortcut replace and uninstall had no automated test. `writeShortcut` and `removeShortcuts`
  are tested against a temp `APPDATA`, which also covers the uninstall path the live check can't.
- **[Fixed]** The rename item missed `rlt-*` ids and `LEGACY_SHORTCUT`; the index had no plan line and two
  over-long lines; Outcome omitted the footer's weight and the verification status.
- **[Deferred → BACKLOG]** `IconFile` as UTF-8 with a non-ASCII profile path (both reviewers), reasoned and
  not seen: logged by `iconIssue`, on the Watch list.
- **[Deferred → BACKLOG]** A shell handle on `favicon.ico` could block `swapWeb`. Not seen: on the Watch list.
- **[Verified, no fix needed]** The share export's useless log for an image failure: inlining removes that
  failure path.
- **[Verified, no fix needed]** `icon-small.svg` at 24 px lands on half pixels: the frame looks fine magnified.
- **[Verified, no fix needed]** `packIco` doesn't validate sizes: `SIZES` is a constant in the same file.
- **[Verified, no fix needed]** "Tracker stopped" in the header uses the generic noun, not the old name.
- **[Disputed]** A source hash to catch `favicon.ico` drifting from its SVGs: the icon rarely changes, and a
  check costs more than the miss. `bun run icons` reproduced the committed file byte for byte in this review.
- **[Disputed]** Sampling the exported PNG for the mark's pixels in e2e: the file is inlined and pinned by the
  src assertion. Checked by eye once instead.

**Round 2** (delta `f733c22`). `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer` (sonnet). `bun run
check` 1193 tests, `bun run e2e` 95 passed.
- **[Fixed]** The new test's `APPDATA` restore would store the string "undefined" if it was unset. Now `vi.stubEnv`.
- No findings from `/code-review` or security.

**Round 3** (delta `db9fd1d`, test only). `/code-review low`, `arch-reviewer` (sonnet). No findings; the review is
closed. The reinstall afterwards swapped `bin\web` with the shortcut already pointing into it, which is one clean
data point for the Watch list item on shell handles.

## Plan review
Round 1 (plan-reviewer, opus). All findings folded in:
1. **High.** The rasterizer must use `channel: "chrome"`, the installed Chrome the e2e config uses
   (`ms-playwright` is empty). Error message fixed; launch under Bun fired once early.
2. **Med.** Transparency (`omitBackground`, exact viewport, DPR 1) and the small-size source file
   are now specified.
3. **Med.** The share e2e check was vague; it now names `naturalWidth > 0` and no
   `share/export_failed`. Inline SVG was considered and rejected: it would put a second copy of the
   paths next to `icon.svg`.
4. **Med.** There is no light theme. Checks now cover carbon/slate/oled plus light and dark tab
   strips.
5. **Low.** `packIco` tests now pin the 256 → 0, planes and bitcount rules.
6. **Low.** A missing favicon after a failed swap is now logged.
7. **Low.** The toast's PowerShell app name is noted as expected.
