# Step 4 package 3b, tray view: review

Substantial by design tier (about 660 non-test lines). Two rounds. The full log, with every disposition, is the
"Review log" in `docs/plans/2026-11-10-wp3b-tray-view.md`; the decision is
`docs/decisions/2026-11-10-tray-view-contract.md`.

## Live checks
Before review, on this PC: the live `tray.test.ts` cases against a fake tracker. By the user (step 8, Windows 11
26200.8655, Focus Assist off): two notices in one poll show as two separate toasts under the tray's own name, and
clicking a live toast opens the browser.

After review, with the installed dev build (`install-autostart`, 2026-11-10), from `supervisor.log`:
- Game closed → `view ready "Ready, waiting for Rocket League"` after "Starting…"; `/api/tray` answers the view with
  the header and 403 without it.
- Tracker force-killed → `poll_failed`, then `unreachable {failures: 2, everAnswered: true}` and red 3.9 s after the
  kill; `reachable` and ready again after the supervisor's 5 s restart.
- The installed tray exe against a closed port → `unreachable {failures: 8, everAnswered: false}` at about 16 s;
  exit 3 on stdin close.

By the user, 2026-11-11/12:
- Game open with the Stats API → green dot; during a match, "Recording a match" (views `Connected` ⇄ `Recording a
  match` in `supervisor.log`).
- `PacketSendRate=0`: no change while the game kept running (the game reads the file at start, as the toast says);
  after a game restart, amber with tooltip "Not getting data from Rocket League" and a "set PacketSendRate to 30"
  notification through the tray (`notice/queued` id 1 → `tray/balloon_shown` → `notice/acked` 2 s later). With the
  game closed and the file still wrong, "Stats API needs setting up".
- A fake tracker with two hostile line urls, each clicked: `url_rejected` for both (a drive path, mangled into
  `C:Windows<LF>otepad.exe` by the check script's own string escaping, and `//evil.example`); nothing opened.
- The menu with Win+B and the keyboard works. Icons and menu look right at 100/125/150 % on light and dark taskbars.
- "Set up Stats API…" shows in the amber menu, and clicking it opens the dashboard, which shows its existing setup
  problem state (the setup card itself is package 4).


## Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- The tray's ack outlived a tracker restart, so the new run's first notices were acked unseen. Both code-review and
  arch found it. [Fixed] Each view carries an `instance`, the ack names it, and an ack from another run acks nothing.
- A non-503 HTTP error turned the tray red. [Fixed] It's a bad answer: the tracker is up.
- The 6 s fallback could toast twice after one slow poll. [Fixed] 10 s.
- The tray read a response with no size limit. [Fixed] Capped at 64 Ki characters, with one reused buffer.
- Several balloons in one poll might replace each other. [Verified, no fix needed] Step 8 showed two toasts.
- The `hadMatch` query sits inside the storage try. [Verified, no fix needed] An unreadable `matches` table means
  storage is broken.
- Each header-less `/api/tray` request writes a warn line. [Deferred → BACKLOG] The existing `write_rejected` and
  `shutdown_rejected` do the same; one rate limit should cover all three.
- Nits: `TRAY_TOASTS` removed after step 8, `Status` imported, icon paths built from the state list, a comment, two
  undocumented deviations recorded. [Fixed]
- simplify: the request-log skip became a `quiet` route flag; `trayParams` transforms to the ack; `game-watch`'s
  toast is required; small notifier and buffer cleanups. Skipped items that would reopen plan decisions are listed in
  the plan.

## Round 2: correctness-reviewer, arch-reviewer (sonnet), security-reviewer, on the delta
A full round, because the `quiet` flag touched `router.ts`. Correctness and security found nothing. Arch found three
nits (a blank line, a cast, a pointer from the plan body to its notes). [Fixed] Done.
