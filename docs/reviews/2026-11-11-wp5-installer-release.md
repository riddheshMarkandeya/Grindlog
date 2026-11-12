# WP5 review summary: installer and release pipeline

Date: 2026-11-11. Plan and full Review log: `docs/plans/2026-11-11-wp5-installer-release.md`.

- Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer, `/simplify`. 13 findings fixed (the biggest:
  smoke-run fetches with no timeout and no job timeout; re-running the workflow or `sign-release` failed; the
  step runner copied three times and already diverging). Security hardening taken: no persisted checkout token,
  and `sign-release` only signs a tag on `origin/master`.
- Disputed: `staticDir` using "web beside the exe" for dev too. The plan keeps dev as it is, and a source run's
  exe is `bun.exe`.
- Round 2 (delta): correctness-reviewer and security-reviewer, clean (one unreachable nit).
- Not covered by any automated check: the installer's Pascal code. The clean standard account checklist in the
  plan is its test, and the user runs it. The CI workflow and `sign-release`'s gh/minisign path run first on the
  `v0.1.0` tag, after the user's one-time setup in `docs/releasing.md`.
