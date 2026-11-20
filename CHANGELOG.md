# Changelog

All notable changes to Grindlog are listed here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Grindlog uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-11-19

### Added
- New seasons arrive on their own: once a day Grindlog fetches the season list from its GitHub repository. Seasons
  you edit or delete stay as you left them. Switch it off in Settings → Seasons.

### Fixed
- Notifications sent while the tray isn't running, and the updater's own, now show as Grindlog with its icon, not
  as "Windows PowerShell".
- Season 23 starts on June 10, not June 9 (unless you changed it yourself).
- Grindlog's icon is sharp in Start, search and Explorer; it was a 16 px image scaled up. The tray icon stays sharp
  when you change the display scale.

## [0.1.5] - 2026-11-18

### Changed
- A maintenance release with no visible changes. It tests that "Check now" finds and downloads a new version.

## [0.1.4] - 2026-11-18

### Added
- Contribution on the recap: your share of your team's score, goals, assists, saves, shots, touches and MVPs this
  session, per team size, with filtered friends broken out. Beside it, "Where the touches were": you, friends,
  teammates and opponents split into defence, midfield and attack thirds.
- The match page shows each player's touches by third under the scoreboard (not on Hoops, Dropshot or Knockout).
- Goal map hovers name the scorer and the assister.
- Settings → Updates has a "Check now" button that checks for an update (and downloads it) straight away
  instead of waiting for the next check, which runs every ~6 hours. It also says when it last checked.

### Changed
- Friends' Contribution panel (renamed from "Who carries") gains Shots and Touches rows and a hover with each
  share's numbers; "Teammate"/"Teammates" replace "Others" and "3rd teammate".
- The goal map has one layout on both pages: the pitch, then Scored and Conceded side by side.
- Icons across the dashboard: the nav, buttons, stat cards and tiles, match rows and markers. They replace the
  game's statfeed icons, and the share card marks its stood-out line with a trend arrow.
- Motion across the dashboard: buttons and cards respond to a press, selection lines slide between tabs, charts
  draw in and then animate between values, and pages rise in as you move between them. With reduced motion turned
  on in Windows, things fade instead of moving.
- Developer installs only: a teal favicon, header logo and exe icon, and a Start menu app shortcut that starts
  the tracker and shows up in search (it was a web link that search skipped). Release builds are unchanged.

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

[Unreleased]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/riddheshMarkandeya/Grindlog/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.1.0
