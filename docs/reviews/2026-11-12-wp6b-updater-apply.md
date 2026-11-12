# WP6b review summary: updater apply, health check and rollback

Date: 2026-11-12. Plan and full Review log: `docs/plans/2026-11-12-wp6b-updater-apply.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`. 11 findings fixed. The
  biggest:
  - The gate could apply a version that wasn't newer than the one running.
  - A crash during a rollback re-offered the failed version.
  - A swapped download could be run after the app stopped (now verified again after the stop).
  - An apply whose updater died past stopping stayed stuck until the next logon.
  - A stale pre-migration backup could be reused after a rollback.
  `/simplify` made one shared `endApply`, a shared backup predicate, `DAY_MS`, and an overdue-only updater
  lookup.
- Deferred: hourly silent `not_started` retries (BACKLOG Watch list). Skipped altitude finding: dropping backup
  reuse would undo plan-review finding 2.
- Round 2 (delta): correctness, arch (sonnet), security. One regression from a round-1 fix was found by two
  reviewers and fixed with a test: a supervisor spawn that throws left the crash path's retry a no-op. Also fixed:
  `endApply` moved to its own module, and downloads are cleared only after state.json is written.
- Round 3 (delta): clean apart from two comment nits.
- Rehearsal on real installs (healthy, rollback and interrupted paths, toast, uninstall) passed. Not checked: the
  Settings Updates sentence at 320 px.
