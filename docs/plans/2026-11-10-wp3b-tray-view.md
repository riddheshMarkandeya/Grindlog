# WP3b: tray view (friends release step 4, package 3, second half)

## Context
BACKLOG step 4 item 3b. 3a shipped the tray exe as a supervised child (`docs/decisions/2026-11-10-tray-process-model.md`):
a fixed icon, Open dashboard, Open logs folder, Quit. The map (`docs/plans/2026-11-06-distribution-map.md`, "Tray" and
"Tray behaviour and first run") wants the tray to be the reliable signal: an icon state, a status line, extra lines,
"Set up Stats API…", and the three toasts through the tray instead of PowerShell's app ID.

Already decided in 3a's plan ("3b outline") and not reopened: the tracker works out the view; `GET /api/tray` needs an
`X-Grindlog-Tray` header (so a cross-site page can't drain toasts), returns icon `ready|active|attention`, status text,
lines `{text, url?}`, setup URL and pending notices from a pure `trayView`; the tray polls every 2 s and turns red
itself when the tracker stops answering after it answered, or after 15 s at startup. Toasts go through the tray when
it polled in the last 10 s, otherwise PowerShell. "Update failed" waits for package 6. A balloon click opens the
dashboard. If balloons don't show on Windows 11, toasts stay PowerShell-only and the reason is recorded. The dev tray
gets a tinted icon set from `make-icons.ts`.

User decisions (2026-11-10):
- **Recompute fold-in: line only.** Keep the last run's failed count and show a quiet line. The rerun-at-every-start
  behaviour stays a BACKLOG item of its own (split out of the 3b item's text).
- **Amber on any config problem** or Stats API off, `no_ini`/`user_missing` included, so setup happens before the
  first match.
- **Icons: prototype first** (dot size/position, dev tint) at real 16/24/32 px, then build the chosen one.

## Design contract (tray)
- **Job:** at a glance, "is Grindlog recording, and do I need to do anything?" One click to the dashboard.
- **Primary action:** left-click opens the dashboard. Secondary: menu.
- **States:** starting (base icon, "Starting…"), ready (base), active (green dot: connected or recording),
  attention (amber dot), not responding (red dot, tray-side only).
- **Rejected:** a custom-drawn popup window, animated icons, counts in the tooltip, a state for update or recompute
  notes (they are lines, per the map).
- Native `NotifyIcon` + `ContextMenuStrip` only, so keyboard access (Win+B, arrows, Enter) comes from Windows.
  High-DPI needs the process marked DPI-aware (step 3), or Windows stretches the 16 px frame and the menu.

### Status text (one per state; `trayView` precedence top to bottom)
| Condition | icon | status |
|---|---|---|
| `connection = recording` | active | "Recording a match" |
| `connection = connected` | active | "Connected to Rocket League" |
| `statsApiOff` | attention | "Not getting data from Rocket League" |
| problem `no_ini` / `user_missing` | attention | "Open Rocket League once to finish setup" |
| other config problem | attention | "Stats API needs setting up" |
| otherwise | ready | "Ready, waiting for Rocket League" |
| (tray) 503 starting / no answer < 15 s | base | "Starting…" |
| (tray) no answer after answering, or 15 s at start | red | "Not responding" |

Connected or recording wins over config problems: data is flowing, and the check reads a file that may be stale.
"Not responding" says what the tray knows; it can't tell a restart from a long synchronous step.

### Interaction contract
| Trigger | Result |
|---|---|
| Left-click icon | Opens `http://127.0.0.1:<port>/` |
| Right-click / Win+B, Enter | Menu: status line (disabled), extra lines (disabled unless they have a url), "Set up Stats API…" (only when `setupUrl`), separator, Open dashboard, Open logs folder, separator, Quit <name> |
| "Set up Stats API…" | Opens `setupUrl` (`/`, resolved against the dashboard URL: package 4's card shows on any page when needed) |
| Line with url | Opens it (same validation) |
| Hover | Tooltip "<name>: <status>", capped at 63 chars |
| Poll answered with a new view | Icon and tooltip updated only when they changed; the menu's top section is rebuilt in `ContextMenuStrip.Opening` from the last view, so an open menu never changes under the cursor |
| Notices in the answer | One `ShowBalloonTip` each for ids above the last shown, in order; acked on the next poll |
| Balloon clicked | Opens the dashboard |
| Poll fails once after answering | Nothing yet; second failure in a row (~4 s) → red, "Not responding" |
| Answer comes back | Back to the view's state |
| Bad JSON / schema mismatch | Keeps the last view, logs `view_bad` once per streak; nothing acked |
| A url not starting with `/` | Not opened; logs `url_rejected` (the answer comes from whatever holds the port) |
| 503 (`starting`, or `stopping` during a shutdown) | "Starting…", base icon; never red. Shown briefly during a quit too; harmless |

## Approach
Review round 1 changed parts of the contract below (ack, fallback, toast switch); the Implementation notes at the
end supersede the text here.


### 0. Save this plan
Copy to `docs/plans/2026-11-10-wp3b-tray-view.md` (Substantial).

### 1. Icon prototype (`prototype` skill)
A throwaway single HTML page under the scratch dir: the base tile with 2–3 dot variants (size, position, ring) in
green/amber/red, and 2–3 dev tints (e.g. the orange line turned blue or teal, a tinted tile), each shown at real
16/24/32 px on light and dark taskbar backgrounds and at 125/150 % scale. The user picks; the choice is written into
the repo plan; the prototype is deleted.

**Chosen (2026-11-10):** dot B, a large dot over the corner: on the 16 grid `r=3.5` at `(12,12)` with a 1-unit ring
in the tile colour (`r=4.5`), scaled ×4 on the 64 grid. Colours: green `#3fb950`, amber `#f0a020`, red `#e5484d`.
Dev tint T2: the orange line `#d95926` becomes teal `#14b8a6`, tile unchanged. Rejected: A (small dot, amber hard to
tell from the orange line at 16 px), C (no ring, merges into the bars), T1 blue (darker against the tile at 16 px),
T3 navy tile (weakest difference on a dark taskbar). The prototype was deleted, not committed.

### 2. `scripts/make-icons.ts`: the tray set
- Draw the chosen dot as SVG overlays on `icon-small.svg` (16/20/24) and `icon.svg` (32/40/48), tinted per channel by
  string substitution of the chosen colours, so there are no extra SVG masters to keep in sync.
- Output `src/tray/icons/<channel>-<state>.ico` for channel `prod|dev` and state `ready|active|attention|stopped`
  (8 files, committed, like `favicon.ico`). Reuse `packIco`; `renderPng` changes to take SVG text instead of a path
  (the favicon caller reads its file first).
- A pure `traySet()` lists the outputs (names, sizes, colours); tested.

### 3. `scripts/build-tray.ts`: embed the channel's set
`trayCompileArgs` takes the four icon paths and adds `/resource:<path>,Grindlog.tray.<state>.ico`; `/win32icon` stays
`favicon.ico` (Explorer's exe icon). Adds `/reference:System.Web.Extensions.dll` for `JavaScriptSerializer`, and
`/win32manifest:src/tray/tray.manifest` declaring `dpiAware true/PM` (plus the Windows 10 `supportedOS` id), so
`SmallIconSize` reports 20/24 at 125/150 % and the menu renders sharp. `buildTray` picks the set by `channel`. Test
updated in `build-tray.test.ts`. The manifest also makes `Environment.OSVersion` truthful, but the `started` line keeps
reading the registry (no change).

### 4. `src/server/tray-view.ts` (pure) + `trayResponse` schema
- `trayView({ connection, statsApiOff, configProblems, recomputeFailed }, notices)` → `{ icon, status, lines,
  setupUrl, notices }` per the table above. `setupUrl` is `"/"` when `icon = attention` from a config problem or
  Stats API off, else null. A line `"<n> match(es) couldn't be rebuilt after the update"` (no url) when
  `recomputeFailed > 0`.
- `trayResponse` zod schema in `src/shared/schemas/responses.ts`; `TRAY_HEADER = "X-Grindlog-Tray"` in
  `src/shared/constants.ts` beside `SHUTDOWN_HEADER`.
- TDD: a table test per row, precedence cases, the line, notices passed through.

### 5. `src/server/notifier.ts`
- Moves `showToast` (and `POWERSHELL_APP_ID`) here from `game-watch.ts`; `game-watch` keeps its title/body text and
  its injected `toast` option.
- `createNotifier({ logger, now, toast = showToast, fallbackMs = 6000, recentMs = 10_000 })`:
  - `notify({ title, body }): Promise<void>` (fits game-watch's `toast` type): if the tray polled within
    `recentMs`, queue `{ id, title, body }` (ids increase per process) and log `notice/queued`; else call `toast`
    (logs `toast/shown|failed` as today) and log `notice/powershell`.
  - **Acked, not drained:** `poll(ack: number | null)` records the poll time, removes notices with `id <= ack` (logs
    `notice/acked`), and returns the rest. A notice still unacked after `fallbackMs` is removed and goes to `toast`
    (`notice/fallback`): covers a tray that died, timed out on a blocked event loop, or hit `view_bad`.
- `TRAY_TOASTS` constant: if step 8's check shows balloons don't appear on Windows 11, set false so `notify` always
  uses PowerShell, and record why.
- TDD with a fake clock and injected toast: no poll → PowerShell; recent poll → queued, returned on every poll until
  acked; stale poll (> 10 s) → PowerShell; unacked at 6 s → fallback once and never returned again; acked at 5.9 s
  → the 6 s timer doesn't toast it; an ack below the id keeps it.

### 6. Wiring
- `release-recompute.ts`: `onDone(result)` passes the `RecomputeResult`; its test asserts it. Main keeps
  `recomputeFailed = result.failed` (0 until a run finishes; a skipped run means the marker was current, so 0). A
  crashed run never calls `onDone`, so the line stays absent; `release_recompute_crashed` in the log covers it.
- `main.ts`: create the notifier before the recorder. Game watch gets `toast: (body) => notifier.notify({ title:
  TOAST_TITLE, body })`. First match: after `openStorage`, `hadMatch = EXISTS(SELECT 1 FROM matches)`; in
  `onMatchFinished`, the first `"written"` save when `!hadMatch` sets it and notifies "<APP_NAME> recorded your first
  match" / "Open the dashboard to see it." (logs `app/first_match`).
- `api/index.ts`: optional `ApiOptions.tray?: (ack: number | null) => TrayResponse` (main builds it from `status()`,
  `recomputeFailed` and `notifier.poll(ack)`, so the API knows nothing of the notifier; existing tests need no
  change, and an absent option answers 404). Route `GET /api/tray?ack=<n>`: without `TRAY_HEADER: 1` → 403 and
  `tray/rejected` (with origin); a non-integer `ack` → 400 through the existing `parse`; else
  `ok(trayResponse, tray(ack))`. The notifier is only touched past the header check.
- **No request log for a tray 200:** the dispatcher's per-request `api/request` line (`api/index.ts` ~295) is skipped
  for `/api/tray` answering 200, or a 2 s poll writes ~43k lines a day and rotates match diagnostics out of the
  25 MiB of logs in about 4 days. 403s, 400s and errors still log; state changes show as `notice/*` and the tray's
  own `tray/*` lines.
- Tests in `api.test.ts`: 403 without the header (notifier untouched), 400 on a bad ack, the shape and ack passed
  through with it, and no `request` line for a tray 200.

### 7. `src/tray/Tray.cs`
- Icons: load the four embedded icons once at `SmallIconSize`; the base icon is `ready`.
- **Poll thread** (background): loop every 2 s: `HttpWebRequest` GET `/api/tray?ack=<lastShownId>` with the header,
  `Proxy = null`, 1.5 s timeout, response disposed in `using` (or the two-connections-per-host limit hangs later
  polls). 200 → `JavaScriptSerializer.DeserializeObject` into the view. A 503 arrives as a `WebException` with
  `Status == ProtocolError`: read the code from `e.Response` (disposed too) → "starting". Any other status or
  exception → failure. Results marshal to the UI thread through `invoker.BeginInvoke` (same pattern and
  `InvalidOperationException` guard as `WatchStdin`); the thread ends when `exited`.
- **Apply on the UI thread:** the red/starting rules from the table; icon and tooltip set only on change; the menu
  top section built in `Opening` from the last view. Notices with id above `lastShownId` →
  `ShowBalloonTip(5000, title, body, ToolTipIcon.None)` each, then `lastShownId` moves up (acked next poll);
  `BalloonTipClicked` opens the dashboard.
- **URL check:** `Open` for view urls accepts only strings starting with `/` (not `//`), resolved against
  `DashboardUrl()`; anything else logs `url_rejected {url}` and opens nothing. (Package 6 can allow a fixed https
  GitHub prefix for "What changed".) The logs-folder item keeps opening `options.Logs` from the command line.
- **DPI:** the manifest from step 3; icons loaded at `SystemInformation.SmallIconSize`.
- **Logs** (stdout JSON, become `tray/<event>` in `supervisor.log`): `view` on icon/status change `{icon, status}`,
  `poll_failed` first in a streak `{error}`, `unreachable` / `reachable`, `balloon_shown {id, title}`, `view_bad`,
  `url_rejected`.
- C# 5 only (no `$""`, `?.`, `nameof`, `=>` members).

### 8. Balloon check (manual, early in step 7)
Build the dev tray, show one balloon on this machine (Windows 11 26200), with Focus Assist off. Record whether it
shows as a toast, under what name, and whether click fires (live only; a click from Action Center isn't expected to).
Also send two notices in one poll and record whether the second replaces the first; if it does, the tray shows one
per poll (the rest stay unacked for the next poll). If balloons don't show, step 5's `TRAY_TOASTS = false` and the
reason goes into the decision record.

### 9. Docs
`documentation-backlog-hygiene`: the `/api/tray` contract and the toast routing amend the 3a decision file (or a new
one if the ADR gate says so); BACKLOG: 3b closed, a new item for the recompute rerun-at-every-start; PROJECT_INDEX
entries for `tray-view.ts`, `notifier.ts`, the icon set.

## Files
`scripts/make-icons.ts`, `scripts/build-tray.ts` (+ tests), `src/tray/icons/*.ico` (new), `src/tray/Tray.cs`,
`src/tray/tray.test.ts`, `src/server/tray-view.ts` (new, + test), `src/server/notifier.ts` (new, + test),
`src/server/game-watch.ts`, `src/server/release-recompute.ts` (+ test), `src/server/main.ts`,
`src/server/api/index.ts` (+ `api.test.ts`), `src/shared/schemas/responses.ts`, `src/shared/constants.ts`.

## Verification
- TDD: `tray-view`, `notifier`, the route, `onDone(result)`, `traySet`, `trayCompileArgs`.
- Live (`tray.test.ts`, skipped without csc), against a `Bun.serve` fake on port 0:
  - answers 503 first → `view {status: "Starting…"}`, no `unreachable`; then a 200 view → `view {icon: "active"}`,
    and the fake saw `X-Grindlog-Tray: 1` and `ack=` on the query;
  - the fake stops → `unreachable` within ~5 s; it restarts → `reachable`;
  - a view with url `C:\Windows\notepad.exe` can't be clicked from a test, so URL rejection is a pure C# helper
    checked by hand (below) rather than a seam worth adding;
  - the notice case (a real balloon pops) runs only with `GRINDLOG_LIVE_BALLOON=1`: the tray logs `balloon_shown`
    and the next request carries `ack=<id>`.
  The 15 s startup-red rule is checked by hand (a fake that never answers would add 15 s to every `bun run check`).
- Full `bun run check` green; the `/compact` line at the implementation→review boundary, then
  `independent-review-pass`.
- Manual, with the installed dev build (`install-autostart`): game closed → ready; game open with the Stats API →
  green, then a match → "Recording a match"; `PacketSendRate=0` → amber, "Set up Stats API…" shown, the toast arrives
  through the tray; end the tracker process → red within ~4 s, then back after the restart; the menu with Win+B and
  the keyboard; icons and menu sharp at 100/125/150 % scale on light and dark taskbars; the tray started against a
  closed port goes red at ~15 s; a fake view with a non-`/` url logs `url_rejected`. Screenshots for the review file.

## Plan review
plan-reviewer (opus), 2026-11-10. All findings folded in:
1. **High.** The 2 s poll would write ~43k `api/request` lines a day and rotate match diagnostics out in ~4 days.
   Fixed: no request log for a tray 200, with a test (§6).
2. **Med-high.** No DPI awareness: `SmallIconSize` stays 16 and Windows stretches icon and menu. Fixed with a
   `/win32manifest` (§3, §7, manual check).
3. **Med.** Drain-on-read lost notices on a timed-out response, `view_bad` or a tray death. Fixed with acks and the
   6 s fallback on unacked notices, plus the 5.9 s test (§5, §6, §7).
4. **Med.** View urls went straight to `Process.Start` with shell execute. Fixed: only `/`-relative urls, resolved
   against the dashboard; `url_rejected` (§7).
5. **Low-med.** `HttpWebRequest` 503 arrives as a `WebException`; responses must be disposed; 503 `stopping` shows
   "Starting…". All named in §7 and the interaction table.
6. **Low.** The deferred-rebuild state machine replaced by building the menu in `Opening` (§7).
7. **Low.** `renderPng` takes SVG text; `ApiOptions.tray` optional; `notify` returns a Promise; a crashed recompute
   shows no line. All folded in.
8. **Low.** Tray-side seams: 503→200 and stop/restart live cases added; the 15 s rule and URL rejection are manual;
   the balloon case is opt-in so `bun run check` pops nothing.
9. **Low.** Two notices in one poll may replace each other: step 8 checks it, with one-per-poll as the fallback.

## Implementation notes (2026-11-10)
All steps done, manual checks included (results in `docs/reviews/2026-11-10-wp3b-tray-view.md`). At step 7:
`bun run check` green (104 files, 1388 tests, 1 skipped: the opt-in balloon case, which passed once
with `GRINDLOG_LIVE_BALLOON=1`). Deviations from the text above:
- **Retry after a failed poll is 500 ms, not 2 s.** A refused connection to 127.0.0.1 on Windows waits out the whole
  1.5 s request timeout, so two failures at the 2 s cadence took ~7 s to red (measured in `tray.test.ts`). With the
  short retry the live test sees red in under 6.5 s (worst case ~5.5 s), so the interaction table's "~4 s" reads ~4–5.5 s.
- **First-run problems outrank other config problems** in `trayView` when both are present (`no_ini`/`user_missing`
  make the rest unknowable until the game writes its settings).
- **No `TRAY_TOASTS` switch.** Step 8 showed balloons work, so the switch (and its `trayToasts` option) went in
  review round 1: a compile-time flag no user could flip anyway.
- **The 403 logs `api/tray_rejected`**, not `tray/rejected`: it matches `write_rejected`/`shutdown_rejected` and
  stays apart from the tray's own `tray/*` lines in `supervisor.log`.
- **Tray icon set:** `src/tray/icons/<channel>-<state>.ico`, each with 16/20/24 px from `icon-small.svg` and
  32/40/48 px from `icon.svg`; `favicon.ico` came out byte-identical.
- **Manifest** declares `dpiAwareness PerMonitorV2, PerMonitor` beside `dpiAware true/PM`.
- **URL check** also rejects whitespace, control characters, `\` and `"` in a view url.
- **Step 8 (balloon check), done by the user on Windows 11 26200.8655 with Focus Assist off:** two notices in one
  poll show as two separate Windows 11 toasts (the second doesn't replace the first), under the tray app's own name,
  and clicking a live toast opens the browser. So `TRAY_TOASTS` stays true and the tray shows every new notice in
  one poll, in order; the one-per-poll fallback isn't needed. Tray-side: two `balloon_shown`, next poll `ack=2`.
- **Review round 1 changes to the contract:**
  - **Acks name the tracker run.** `trayResponse` carries `instance` (random per tracker process); the tray sends
    `?ack=<id>&instance=<run>` from its last answer (no query before the first), and the notifier ignores an ack
    from another run. Without it, the tray's ack outlived a supervisor restart of the tracker and silently acked the
    new run's notices 1..N.
  - **Fallback is 10 s, not 6 s**: one timed-out poll after the balloon showed pushed the ack past 6 s and the same
    toast showed twice.
  - **A non-503 HTTP error is a bad answer** (`view_bad {error: "http <code>"}`, 2 s cadence), not a failure: the
    tracker is up, so it isn't red.
  - **The tray reads at most 64 Ki chars** of a response; more is a bad answer.
  - **A bad answer while red shows "Starting…"**, not the pre-outage view, which is stale by then.

## Review log
### Round 1 (Substantial: design tier; 664 lines non-test). Snapshot `99b5628`.
Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify`. Security: no findings.
- Tray ack survives a tracker restart; new run's notices acked unseen (code-review + arch, bug). [Fixed] instance token in
  the view and the ack; notifier test for an earlier run's ack; live test for the echoed `ack`/`instance`.
- Non-503 HTTP status turns the tray red and retries at 500 ms (code-review). [Fixed] bad answer; live test with a 500.
- 6 s fallback can duplicate a toast after one slow poll (code-review). [Fixed] 10 s.
- Several `ShowBalloonTip` calls in one poll replace each other (code-review). [Verified, no fix needed] step 8: two
  notices showed as two toasts.
- `tray_rejected` warn line per header-less request lets a page flood the logs (code-review). [Deferred → BACKLOG] the
  same holds for the existing `write_rejected`/`shutdown_rejected`; one rate limit for rejected-request lines.
- Unbounded `ReadToEnd` on an untrusted response (code-review). [Fixed] 64 Ki char cap.
- `hadMatch` query inside the storage try exits as start_failed (code-review). [Verified, no fix needed] an unreadable
  `matches` right after `openStorage` migrated it means storage is broken; start_failed is the right outcome.
- `tray-view.ts` re-derives `Status` (code-review). [Fixed] imports it.
- `trayIconPaths` lists states by hand beside `TRAY_STATES` (code-review + arch, nit). [Fixed] built from the list.
- `TRAY_TOASTS` is speculative config (code-review). [Fixed] removed after step 8.
- `trayParams` comment says ack is left out until the first poll (arch, nit). [Fixed] rewritten with the instance.
- Log name `api/tray_rejected` vs plan's `tray/rejected` undocumented (arch, nit). [Fixed] implementation notes.
- Bad answer while red shows "Starting…", not the last view, undocumented (arch, q). [Fixed] comment and notes.
- `/simplify` (reuse, simplification, efficiency, altitude), applied:
  - the request-log skip is a `quiet` flag on the route table, not a `/api/tray` special case in the dispatcher
    (`router.ts` gains the field);
  - `trayParams` transforms to `TrayAck | null`, so the pairing lives in the schema and `TrayAck` is inferred;
  - `game-watch`'s `toast` is required (main always passes it), so it no longer imports `showToast`;
  - the tray reuses one 64 Ki body buffer instead of a large-object-heap allocation per poll;
  - notifier: `{ id, ...t }`, one `splice` in the fallback, one filter for the acked log.
  Skipped: ack as a POST, or a declarative header gate (the plan's GET + `X-Grindlog-Tray` decision; the three gates
  differ in log and answer); `tray` required (the plan made it optional so existing API tests need no stub); moving
  the recompute and first-match state out of `main` (main is the wiring site; one flag each); `showToast` in its own
  module (the plan put it in the notifier); unref'd fallback timers (every exit goes through `process.exit`); one
  state list shared with Tray.cs (a missing resource fails the live `tray.test.ts` build); dropping `showingView`
  and `TrayIcon.sizes` (small gains, and a C# state change would need the live checks again).
  `bun run check` green after: 104 files, 1389 passed, 1 skipped.

### Round 2 (full: a fix touched `router.ts`, outside round 1's diff). Delta `git diff 99b5628`; snapshot `b99068c`.
Passes: `correctness-reviewer`, `arch-reviewer` (sonnet), `security-reviewer`. Correctness and security: no findings.
- Two blank lines left where `TRAY_PATH` was (arch, nit). [Fixed]
- `splice(...) as [TrayNotice]` cast in the fallback (arch, nit). [Fixed] reads the notice first; behaviour-identical.
- Plan body still describes the pre-review contract (arch, nit). [Fixed] a pointer to the Implementation notes.
Nits only, so the review is done. `bun run check` green: 104 files, 1389 passed, 1 skipped.
