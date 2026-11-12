# The tracker works out the tray's view, and toasts go through the tray with acks

Date: 2026-11-10

## Context
WP3a made the tray a supervised child with a fixed icon (`2026-11-10-tray-process-model.md`). WP3b gives it state:
an icon, a status line, extra lines, "Set up Stats API…", and the app's toasts. Two programs, released together but
restarted separately (the supervisor restarts a crashed tracker and leaves the tray running), now share a contract.
Plan, implementation notes and review log: `docs/plans/2026-11-10-wp3b-tray-view.md`.

## Decision
- **`GET /api/tray?ack=<id>&instance=<run>`** answers `{ icon: ready|active|attention, status, lines: [{text, url?}],
  setupUrl, instance, notices: [{id, title, body}] }`, built by the pure `trayView` (`src/server/tray-view.ts`).
  The tray adds only what it alone knows: "Starting…" before an answer or on a 503, and red "Not responding" after
  two failed polls once it has had an answer, or 15 s from its own start without one.
- **The header `X-Grindlog-Tray: 1` is required** (403 and `api/tray_rejected` without it), because the GET acks
  notices: a cross-site page can't add the header without a preflight the server never answers.
- **Acked, not drained.** The notifier (`src/server/notifier.ts`) keeps a queued notice until the tray acks its id.
  A notice unacked after 10 s goes to PowerShell instead and is dropped from the queue, so a timed-out response,
  bad JSON or a dead tray never loses one.
- **Acks name the tracker run.** Ids restart at 1 in each tracker process, so the view carries a random `instance`,
  the tray sends it back with its ack, and an ack naming another run acks nothing.
- **Routing:** through the tray when it polled within 10 s, else straight to PowerShell's app ID.
- **The tray opens only `/`-relative urls**, resolved against the dashboard; whatever holds the port writes the
  view, so anything else logs `url_rejected`.
- **Polls stay out of the request log.** A `quiet` route skips the per-request line for 2xx answers, or a 2 s poll
  would rotate match diagnostics out of 25 MiB of logs in about 4 days.

## Why
- The view in the tracker keeps the C# 5 exe a dumb renderer, and keeps the precedence rules testable in TypeScript.
- **Toasts through the tray:** they show under the app's own name, and a click opens the dashboard. The
  PowerShell-only alternative shows "Windows PowerShell" and can't open anything. A live check on Windows 11
  26200 showed both effects. It also showed that two balloons in one poll appear as two toasts, so the tray shows
  every new notice in order.
- **Drain-on-read** was simpler but lost the notice on any failed response. Acks cost one query parameter.
- **The instance token:** a crash restart would otherwise ack the new run's first notices unseen. The other option,
  ids that keep growing across restarts, needs persisted or time-seeded state in a C# `int`.

## Files touched
`src/server/tray-view.ts`, `src/server/notifier.ts`, `src/server/api/index.ts`, `src/server/api/router.ts`,
`src/server/main.ts`, `src/server/game-watch.ts`, `src/server/release-recompute.ts`,
`src/shared/schemas/{params,responses}.ts`, `src/shared/constants.ts`, `src/tray/Tray.cs`, `src/tray/tray.manifest`,
`src/tray/icons/`, `scripts/make-icons.ts`, `scripts/build-tray.ts`.

## Verification
Unit tests for `trayView`, the notifier (fake clock: routing, acks, an earlier run's ack, the 10 s fallback, an ack
at 9.9 s), the route (header, ack and instance, 400s, no request line on 200). Live `tray.test.ts` against a fake
tracker: 503 → "Starting…" → the view, the header, the echoed ack and instance, red within ~5 s of a stop and back,
`view_bad` once, a 500 as a bad answer at the 2 s cadence; an opt-in live balloon case. Review:
`docs/reviews/2026-11-10-wp3b-tray-view.md`.

## Related
`docs/decisions/2026-11-10-tray-process-model.md` (WP3a, the process model this builds on);
`docs/plans/2026-11-06-distribution-map.md` ("Tray", "Tray behaviour and first run").
