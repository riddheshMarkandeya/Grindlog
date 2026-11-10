# Step 4 package 1, rename, identity and data move: review

Substantial by design tier (about 470 non-test lines). Three rounds, ending clean. The full log, with every
disposition, is the "Review log" in `docs/plans/2026-11-09-wp1-rename-identity.md`.

## Live checks
- 5a: the compiled exe with `--supervisor` started its bare child as the tracker; both show "Grindlog Dev", logs
  land in `<data>\logs`, and the shutdown ended both.
- 5b: `move-data`'s in-use probe refused while a file was open and left nothing renamed.
- Switch-over: the old install was removed by its own uninstall from a worktree of `74599a6`. `move-data` copied 11
  files (494,126,283 bytes) and passed SHA-256 and `quick_check`. Deploy then recomputed 211 records with 0 failures,
  and 49102 shows 211 matches, 210 on the 2026 played-days.
- Repro (c): with `grindlog-dev.new.exe` held, the install kept the old exe, ran the task again and exited 1 with
  "running again, but not updated".
- Closing checks: old names remain only in `registry.ts`'s doc path, in code and in the exe. The old dir, task and
  shortcuts are gone.
- Round 1 fix: the path-filtered kill was checked live, then as a test, against two same-named exes.

## Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- Bug: after the merge into one exe, `taskkill /IM` also ended trackers, including a hand-run copy elsewhere.
  [Fixed] `killExe` matches the full path, and the supervisor's command line too.
- Bugs in `move-data` edge cases: an empty plan still put the source aside, `<to>` as a file threw, and a failed
  cleanup gave a raw stack trace. [Fixed] Each now has a test.
- Nits: `stop.ts` messages now use `APP_NAME`, the LOCALAPPDATA helper is shared, the e2e badge test is
  channel-aware, plus small tidy-ups. [Fixed]
- `.channel` CSS should compose `.chip`. [Disputed] They deliberately differ.
- A supervisor pidfile or stop channel instead of a filtered kill. [Deferred] To package 2's `--quit` (BACKLOG).
- Source re-hash in `verify`, and the duplicate list of locked-file errnos. [Verified, no fix needed]

## Round 2: arch-reviewer (sonnet), security-reviewer, on the delta
- `killExe` had no automated test. [Fixed] Added, and confirmed red without the path filter.
- Silent lookup failures, a comment's accuracy, and an inline default. [Fixed]

## Round 3: code-review low, security-reviewer, on the delta
No findings.
