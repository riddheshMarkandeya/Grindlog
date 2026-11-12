# Releasing Grindlog

A release is one `Grindlog-Setup-X.Y.Z.exe` plus its `.minisig` on GitHub Releases. CI builds the
installer on a pushed tag and leaves a draft; signing and publishing happen on the developer's PC,
because the signing key never leaves it.

## One-time setup

1. GitHub CLI: `winget install GitHub.cli`, then `gh auth login`.
2. minisign: install scoop (https://scoop.sh), then `scoop install minisign`.
3. The key pair, from the repo root: `minisign -G -p minisign.pub`. It asks for a password and says where it
   saved the secret key (`minisign.key`, outside the repo).
4. Keep the secret key and its password in the password manager, plus one offline copy (a USB stick). A lost
   key means every friend reinstalls by hand once, since the updater only trusts this public key.
5. Commit `minisign.pub` at the repo root. `build-release` bakes its key line into the exe and refuses to build
   without it (`--update-key <path>` points a rehearsal build at another key), and its smoke run checks
   `/api/update` says `enabled: true`. Update checks are the app's only outbound requests: the supervisor asks
   GitHub's `releases/latest` 3 min after start and every ~6 h, and the Settings page's Updates section says so.
6. For local builds, Inno Setup 6: `winget install JRSoftware.InnoSetup`. `build-release` finds it under
   Program Files or `%LOCALAPPDATA%\Programs`, or set `ISCC` to `ISCC.exe`'s path.

## Each release

1. Bump `version` in `package.json`: `X.Y.Z` for a release, `X.Y.Z-rc.N` for a prerelease (the draft is
   marked prerelease automatically).
2. Optional local check: `bun run build-release`. It builds `release/Grindlog-Setup-<version>.exe` and
   smoke-runs the exe (version, prod channel, dashboard served, `InternalName`).
3. Commit, then `git tag vX.Y.Z` (it must be `v` + the package.json version, or CI fails) and push the
   commit and the tag.
4. Wait for the `release` workflow (Actions tab). It runs `check`, `e2e` and `build-release --tag`, then
   leaves a draft release holding the installer.
5. `bun run sign-release vX.Y.Z`. It checks that the draft holds the installer and that its version
   matches, signs it (minisign asks for the password), verifies the signature against `minisign.pub`,
   prints the trusted comment and uploads the `.minisig`.
6. On GitHub, write the release notes and publish the draft.

## When something fails

- **CI fails at `build-release`**: the log names the step. `The tag ... doesn't match` means the tag and
  package.json disagree: delete the tag (`git tag -d vX.Y.Z`, `git push origin :refs/tags/vX.Y.Z`), fix and
  tag again.
- **A broken draft**: delete it on GitHub, delete the tag as above, and tag again.
- **`sign-release` says the release is already published**: it never re-signs a published release. Publish
  a new version instead.
- **A published release with a bad signature or the wrong file**: installs that checked it have skipped that
  version for good, and they won't retry it even if its files are re-uploaded. Delete the release and
  publish a new version.
- **The installer itself**: Inno writes a log to `%TEMP%` on every install and uninstall (`Setup Log <date>
  #<n>.txt`, or wherever the updater's `/LOG=` points). It says
  whether `--quit` ran before the files were replaced (with its exit code), whether the logon task was
  found, created or failed, whether data was deleted at uninstall, and which version was installed.
- **An update that rolled back** (a friend's tray says "Update X didn't start, so Grindlog went back to Y"):
  `<data>\logs\updater.log` has each phase, the installer's exit code, the health readings and what was
  restored. Inno's own logs are `<data>\logs\install-<version>.log` and `rollback-<version>.log`. The databases
  the failed version migrated are kept in `<data>\failed-update\<version>\` until the next healthy update, and
  that version is skipped for good on that PC: fix it and publish a new version.
- **"needed more disk space"**: the new version's tracker found too little room for its pre-migration backup
  (`db/low_disk` in `tracker.log`) and migrated nothing.
- **A "couldn't restart" toast, or "may not have finished"**: the old version didn't come back either, or the
  updater died after the new one started (`apply_interrupted` in `supervisor.log`). Reinstalling the latest
  release by hand opens the databases as they are.

The old rule against tagging between WP6a and WP6b (a 6a build could download an update but not apply it) ended
with WP6b.
