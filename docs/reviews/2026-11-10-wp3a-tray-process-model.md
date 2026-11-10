# Step 4 package 3a, tray exe and process model: review

Substantial by design tier (about 800 non-test lines). Four rounds. The full log, with every disposition, is the
"Review log" in `docs/plans/2026-11-10-wp3a-tray-process-model.md`; the decision is
`docs/decisions/2026-11-10-tray-process-model.md`.

## Live checks
Before review, on this PC after `install-autostart`: tray killed and back in 5 s, tracker killed and restarted with the
tray staying, `--quit` exit 0 with the tray out through its stdin, `--open`, `schtasks /End` with no ghost icon, 4.8 MB
private working set. By the user: menu items and left-click, Quit (icon gone, everything stopped in about 70 ms), the
dashboard tab and logs window staying open, and the icon coming back after an Explorer restart.

## Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- Quit never asked a tracker that answered "starting" (a long backup ended in a job kill), and one 30 s deadline
  covered asking and the exit together. [Fixed] Asked after a 5 s child-age check (settled in round 4); an accepted
  stop gets its own 30 s.
- The tray swap ran beside a kept old exe; exit 2 was retried; the tray's default exit code read as bad arguments; a
  stdin close after Quit could crash or turn 0 into 3; the `--quit` grace had no margin. [Fixed] Each with a test where
  it can be scripted.
- `runSupervisor` held three responsibilities in ~170 lines. [Fixed] `superviseTray` and `quitTracker` are their own
  functions.
- A force-killed supervisor can leave a ghost icon. [Verified, no fix needed] A recorded Limit; none was seen on
  Windows 11 26200.
- simplify: no edits; the altitude suggestions (Quit through `--quit`, tray-owned logs, no grace) would reopen
  decisions the map and plan settled.

## Round 2: code-review high, arch-reviewer (sonnet), security-reviewer, on the delta
- Asking "starting" dropped the foreign-tracker guard. [Fixed] Only once the child has run 5 s.
- Retry logs didn't say what the probe saw; `stop()` raced the drain and could log a clean exit as killed. [Fixed]
- Stale `stopping` wording in the decision file and plan. [Fixed]

## Round 3: code-review medium, security-reviewer, on the delta
- The 5 s rule counts from spawn, not bind. The third round on this topic, so it went to the user, who chose to put
  the pid in the host's pre-API 503. Two missing regression tests were added (both fail against their mutation).

## Round 4: code-review high, arch-reviewer (sonnet), security-reviewer, on the delta
- The 503 path never runs: startup from bind to mount is synchronous, so a starting tracker answers nothing. Back to
  the user, who chose the simplest fix: [Fixed] the 503 pid reverted; the 5 s rule stays and the leftover case (a
  duplicate's tracker on the port while ours took over 5 s to bind) is a Limit in the decision file.

Security found nothing in any round.
