# Contributing

These are the working rules for this repo, for people and AI agents alike.

## Setup and the bar

- Install [Bun](https://bun.com) 1.4.3, then `bun install`.
- `bun run check` must pass: typecheck, lint with zero warnings, and the unit tests.
- For a change to the dashboard or the server, also run `bun run e2e` (it drives the installed Chrome).
- New logic comes with tests, written before the code. A bug fix comes with a test that fails without the fix.

## Finding your way

Read [`PROJECT_INDEX.md`](PROJECT_INDEX.md) first: it says where everything lives and lists every command.

- `docs/plans/`: plans, one per piece of work, with their results
- `docs/decisions/`: decision records
- `docs/reviews/`: review summaries
- `BACKLOG.md`: open items, and the Watch list of things waiting on real data
- `docs/releasing.md`: how a release is built, signed and published

## Commits

Use the prefixes the log already uses: `feat:`, `fix:`, `docs:`, `test:`, `chore:` (and `refactor:`). The subject
says what changed; the body says why, and records any decision that's too small for its own decision file.

## Changing a stat rule

Every stat rule lives in `src/server/rules/registry.ts` with a version. Change one rule at a time:

1. Edit its entry and bump its version.
2. `bun run rules-diff` to see which stored matches it moves.
3. `bun run definitions` to regenerate `docs/definitions.md`. A test fails if the doc is out of sync, or if a
   constant changed without a version bump.

`PROJECT_INDEX.md` has the full sequence.

## Privacy

Never commit `captures/`, `HARs/` or any real match data; they are git-ignored. Test fixtures in `test/fixtures/`
are anonymised excerpts of captures.

## Stats API data nobody has seen yet

When code meets a Stats API event order or field shape that no captured or stored match shows, don't guess at
handling it. Flag it with a check, keep the flagged match (retention keeps flagged matches whole), and add a Watch
list item to `BACKLOG.md` saying what would trigger the real fix. The handling is written once a real match shows
the shape.

## AI agents

- Read `PROJECT_INDEX.md` and this file before changing anything.
- Follow the test, commit and privacy rules above.
- Don't commit or push unless the maintainer asks you to.
