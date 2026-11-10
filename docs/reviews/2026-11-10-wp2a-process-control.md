# Step 4 package 2a, process control: review

Substantial by design tier (about 430 non-test lines). Three rounds, ending clean. The full log, with every
disposition, is the "Review log" in `docs/plans/2026-11-10-wp2a-process-control.md`.

## Live checks
- Spike: `Bun.spawn` with `detached: true` kept the child alive through the parent's own exit, a force-kill, an exit
  under a scheduled task and Task Scheduler's End, with cwd and env intact; a plain child died in every case.
- Repros 5a-5f on a scratch compiled exe (port 49150): cold `--open`, a second `--open`, `--quit` running, `--quit`
  in the crash backoff, `--quit` idle, and the logs. The no-browser-open run of 5a was skipped (user).
- After round 1's fixes, (c) and (d) again, plus `--quit` ending a waiting `--open`: all exit 0, nothing left.
- Deploy to dev: `/api/status` has `version: null` and the tracker's pid.

## Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- `--quit` ignored a waiting `--open`, which holds the exe and can restart the app after `done`. [Fixed] `--quit` ends
  `--open` launchers. This revisits plan-review item 6; the user agreed.
- A failed stop request was never re-sent; `--open` never started a tracker once a stopping one freed the port;
  `statusProbe` rejected other builds' status shapes; `pidAlive` read EPERM as gone; an escaped throw left no log
  line. [Fixed] Each has a regression test, apart from the logged `crashed` catch.
- `lookup_failed` logged every tick, a spike story in a comment, a hardcoded spawn method, the shutdown-order
  dependency not commented. [Fixed]
- The 2 s probe timeout vs a slow refusal. [Verified, no fix needed] Refusal measured at 0-12 ms.
- simplify: kill by pid from `quitApp`'s own listing (one PowerShell per tick, not two), a 15 s lookup timeout,
  small tidy-ups. Five suggestions skipped, listed in the plan.

## Round 2: code-review low, arch-reviewer (sonnet), security-reviewer, on the delta
- `kill_failed` logged every tick, and ESRCH counted as a failure. [Fixed] With a test.
- Inline `SPAWN_METHOD`, pass the count key directly. [Disputed] Both keep the log or the pairing from drifting.

## Round 3: code-review low, arch-reviewer (sonnet), security-reviewer, on the delta
- No findings; one test-only nit applied.
