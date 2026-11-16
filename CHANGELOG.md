# Changelog

All notable changes to Grindlog are listed here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Grindlog uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Icons across the dashboard: the nav, buttons, stat cards and tiles, match rows and markers. They replace the
  game's statfeed icons, and the share card marks its stood-out line with a trend arrow.

## [0.1.3] - 2026-11-13

### Added
- A README, an MIT licence, this changelog and a contributing guide.
- The installer puts `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` (the licences of the software Grindlog ships) next
  to the app.

### Changed
- `grindlog.exe`, the tray app and the installer carry Grindlog's copyright in their file properties, in place of
  Bun's licensing link.
- The installer's support link points at the renamed `Grindlog` repository.

## [0.1.1] - 2026-11-12

No changes to the app. This release proved the update path end to end: 0.1.0 found it on GitHub, verified it and
installed it on its own.

0.1.2 was used for an internal rollback test and skipped.

## [0.1.0] - 2026-11-12

The first release.

### Added
- Records every Rocket League match through the game's Stats API and keeps it on your PC.
- A dashboard in the browser with your sessions, match recaps, stats and trends.
- A per-user Windows installer that needs no admin rights, starts Grindlog when you sign in, and asks on uninstall
  whether to keep your match history.
- A tray icon that shows Grindlog's state and helps turn on the game's Stats API.
- Update checks against GitHub releases, with signed downloads, installs only while the game is closed, and an
  automatic rollback if a new version doesn't start.

[Unreleased]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.1.0
