# Grindlog

Grindlog is a Rocket League stats tracker that runs on your own PC. It listens to the game's built-in Stats API while
you play, saves every match, and shows your sessions, stats and trends on a dashboard in your browser. Everything
stays on your machine.

Grindlog is not affiliated with or endorsed by Psyonix or Epic Games.

## Install

1. Download `Grindlog-Setup-X.Y.Z.exe` from the [latest release](https://github.com/riddheshMarkandeya/Grindlog/releases/latest).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen warns about it: click **More info**, then
   **Run anyway**.

It installs for your Windows user only, into `%LOCALAPPDATA%\Programs\Grindlog`, and doesn't need admin rights. It
needs 64-bit Windows 10 version 1903 or later.

## First run

- The dashboard opens by itself when the installer finishes, at `http://127.0.0.1:49100`. Grindlog then starts
  whenever you sign in to Windows. The **Grindlog** Start menu shortcut opens the dashboard again.
- If the game's Stats API isn't turned on yet, a setup card on the dashboard turns it on for you with one click, or
  shows the steps by hand when it can't. Restart Rocket League afterwards: the game reads the setting only when it
  starts. If you've never run Rocket League on this PC, open it once first so it writes its settings file.
- Grindlog lives in the tray, next to the clock. Windows may hide it under the `^` arrow; drag it out to keep it in
  sight. Left-click it to open the dashboard, or right-click it for the menu. The dot on the icon shows the state:
  - no dot: ready, waiting for Rocket League
  - green: connected to the game, or recording a match
  - amber: needs your attention, usually the Stats API setup (hover for what's wrong)
  - red: Grindlog isn't responding

## Privacy

Your matches, stats and logs stay in `%LOCALAPPDATA%\Grindlog`. The dashboard only listens on `127.0.0.1`, so other
devices can't reach it. Grindlog goes online only for updates, through this repository's GitHub releases. It
checks 3 minutes after it starts, then about every 6 hours, and downloads an update when you install one.

## Updates

When a new version is out, the tray menu shows **Install update X.Y.Z…**, which opens the update settings on the
dashboard. An update installs only while Rocket League is closed, and Settings has a switch to install updates on
their own. Every download is checked against the project's minisign key (`minisign.pub`, built into the app) before
it runs. If a new version doesn't start properly, Grindlog goes back to the version you had and says so.

## Uninstall

Open Windows **Settings → Apps → Installed apps**, find **Grindlog** and choose **Uninstall**. It stops Grindlog and
removes it from sign-in, then asks whether to also delete your match history. The default is **No**, which keeps
`%LOCALAPPDATA%\Grindlog`, so a later install picks up where you left off. Choose **Yes** to delete it.

## Troubleshooting

Right-click the tray icon and choose **Open logs folder**. If something went wrong, send `tracker.log` and
`supervisor.log` from there; for an update problem, add `updater.log` and
`launcher.log`.

## Building from source

You need [Bun](https://bun.com) 1.4.3 on Windows.

```sh
bun install
bun run check      # typecheck, lint (zero warnings) and unit tests
bun run e2e        # builds the dashboard, then runs the Playwright tests in the installed Chrome
bun run web:build  # builds the dashboard into dist/
bun run start      # runs the tracker from source (dev data folder, port 49102)
bun run dev        # a second tracker with its own data: .dev-data/, port 49101
```

- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to work on the repo, for people and AI agents
- [`PROJECT_INDEX.md`](PROJECT_INDEX.md): where everything lives and every command
- [`docs/releasing.md`](docs/releasing.md): how a release is built, signed and published

## Licence

MIT, see [`LICENSE`](LICENSE). The licence doesn't cover the Rocket League statfeed icons the dashboard uses, which
belong to Psyonix and Epic Games. Grindlog ships third-party software under its own licences, listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); the installer puts both files next to the app.
