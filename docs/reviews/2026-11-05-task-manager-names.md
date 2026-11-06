# Task Manager names (friends release step 3): review

Standard by diff (about 60 non-test lines). Two rounds, ending clean.

## Live checks
- Spike: both real entries, compiled with every flag plus `--windows-hide-console`, ran from a scratch
  folder on port 49102. The supervisor started the tracker, the port answered, `bun run stop` ended both.
  It needed `paths.ts` changed first, because the supervisor and tracker names are compiled in.
- `VersionInfo`: FileDescription, ProductName, CompanyName, FileVersion and ProductVersion all take the
  flags' values. InternalName stays `bun`, LegalCopyright stays Bun's licensing URL, OriginalFilename is
  empty. The app icon extracts from the exe at 32 px; smaller sizes are left to the check by eye.
- Real install, from the old names: legacy exes removed, the task points at `grindlog-supervisor.exe`,
  the dashboard answers, no main window. A second install ran with no legacy messages. `bun run stop`,
  then the task's `/Run`, brought it back.
- Failed removal: a running copy named `rltracker.exe` logged the "could not remove" line and
  `removeLegacyExes` returned. With `{ recursive: true, maxRetries: 5 }` it returned in 1 ms on EPERM, so
  Bun 1.4.3 did not retry there.
- Not exercised live: the kill of a legacy supervisor sleeping between restarts.

## Round 1: code-review medium, arch-reviewer (opus), security-reviewer
- Bug, `PROJECT_INDEX.md:5` said step 3 was still to come. [Fixed]
- Risk, `maxRetries` on the legacy removal did nothing. [Fixed] Removed: the live run showed adding
  `recursive` wouldn't make it retry.
- Messages said "Task Manager", whose Processes tab doesn't show exe names. [Fixed] They name the Details tab.
- Stale `BACKLOG.md` clause; step 4 and 5 follow-ups only in step 3's section; `PRODUCT_NAME` not used for
  descriptions; `version` shadowed; no `removeLegacyExes` test. [Fixed]
- `stop.ts` doesn't end a legacy supervisor. [Verified, no fix needed] The only machine has migrated.
- A `/Create` failure leaves old exes serving the new dashboard. [Verified, no fix needed] Same reason.
- Orphaned `rltracker*.new.exe` no longer cleaned. [Verified, no fix needed] None exists.
- `${version}.0` with a prerelease version. [Deferred] Step 4 in the release map, as planned.
- Three similar best-effort delete helpers; legacy names listed twice; hard-coded `.new.exe` names.
  [Disputed] The legacy code is temporary, and the `.new.exe` names follow the existing form.
- Whether the legacy code is needed now the migration has run. Left to the user, who chose to delete it.

Security: no findings.

## Round 2: code-review low, arch-reviewer (sonnet), security-reviewer, on the delta
No findings.

## Round 3: code-review low, security-reviewer, on the delta
The legacy exe code removed after the one real migration had run, which also retires its untested kill
path and the findings about it above.
