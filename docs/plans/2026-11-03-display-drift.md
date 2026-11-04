# Display drift and data sense: audit and fixes

## Context
BACKLOG item "Display layer drift across pages" (`BACKLOG.md:79`, user 2026-10-28) was written
before the Friends page was built. The user asked for a fresh audit across every page, to find
what the item missed, plus a second audit for data that is repeated or doesn't make sense. Three
read-only audits covered recap (Overview, Matches, MatchView, SessionPicker, ShareCard,
Scorebug, GoalMap), Trends, Settings, the app shell and Friends (landing, friend, pair). Key
claims were checked against the code.

Tier: **Substantial**. It adds shared components and makes colour-role decisions, and the work
spans more than one session, so it's split into work packages below. Retro deferred one week at
the user's request (step 0).

## What the fresh audit found (beyond the backlog item)
Already done since the item: a shared `components/Tile.tsx` exists, used by recap headline tiles
and Friends zones.

**Big-number face**: six sizes and mixed italics.
- Trends metric tiles: 22px Segoe 600 (`Trends.module.css:64`). The worst offender.
- Trends record: condensed 700, not italic (`:53`).
- Overview `.stat b`: condensed 800 28px, not italic (`Overview.module.css:52`).
- MatchView score `h2`: plain Segoe 32px.
- ShareCard record: plain Segoe 64px.
- Friends landing `.rv`: a hand-copied Tile face at 26px.
- The Bahnschrift stack is repeated in five CSS files.

**Tile anatomy**: five kinds outside `Tile.tsx`.
- Overview `.stat`: label over value, left-aligned grid, units in `small`, a sub line.
- Trends `MetricTiles`: label over value, a button with a sparkline and a selected state.
- Friends landing record cell: label over value over bar, 11px label.
- ShareCard `.tile`: value over a 9.5px label, its own scale on purpose.
- Trends `StatsLine`: matches, sessions, best streak and MVPs written as prose.

**Headings**
- Sizes: 15, 16 and 18px; 11 and 13px uppercase.
- Placement mixes above-panel and inside-panel on the same page (Overview: "What stood out" and
  "By playlist" sit inside panels, the others above).
- Friends zone headings are uppercase 13px with a coloured rule.
- Settings h2s are 18px.
- Page h1: visible on Recap and Friends, hidden on Trends and Settings.
- The hint "select a day to open its recap" is inside the W/L chart's h3.

**Colour roles**: confirmed leaks.
- `--up`/`--down` have four meanings: delta, the save ✓/✗ (`SaveStatus`), connection dot
  (`Header.module.css:19-22`) and error text (Settings, Overview, Friends).
- MatchView `TEAM_TONE` (`MatchView.tsx:129`): blue means "yours", or the game's blue team when
  yours is unknown.
- Friends: the class `.them` means `--friend-a` in the carry bar (`Friends.module.css:103`) and
  an orange opponent in the against-zone match table (`:129`). The colours are right, but one
  class name has two meanings.
- `ShareCard.module.css:16` has a hardcoded `#000a` backdrop.
- `#0c1a2b` is hardcoded three times (`Friends.module.css:102-104`), not themed.
- ShareCard gradient uses hardcoded `#3987e540`/`#d9592640` copies of the tokens, as decoration.
- `--flag` marks the Suggested panel edge, which is decoration and not a warning.
- Trends uses `--accent` for both "selected" and the data line. On oled the line is white, the
  same as the text.

**Shared CSS copied in each module**
- `.panel` ×5 and table styles ×4, with different sizes and padding.
- `.muted` ×4 in two different colours.
- `.up`/`.down` ×3.
- Two segmented controls: Trends `.xmode` and Settings `.seg`.
- About six button styles, and two `.link` rules.

## Data that is repeated or doesn't make sense
Each item is marked **[bug]** for a wrong number or colour, **[clutter]** for a repeat, or
**[label]** for a mismatch between the label and the computation.

Bugs (verified):
- B1 [bug] Friends Overtime tile: "50% of 4", where % uses w+l and 4 is `n`, which includes
  no-result matches (`zones.tsx:108`).
- B2 [bug] Compare Diff: a tiny positive difference prints "+0" in green, because the sign comes
  from the raw value and the text from the rounded one (`zones.tsx:228-229`).
- B3 [bug] No thousands separator, so a session's Score total reads "12345". The cause is raw
  JSX numbers (`Overview.tsx:203` `{c.total} total`, `MatchView.tsx:180` `{p.score}`,
  `GoalMap.tsx:58,124`) and `decimal()` (`logic/format.ts:60`).
- ~~B4~~ Not a bug (plan review): the Friends "Match by match" table only appears in the
  against zone, so the friend there is an opponent and orange is correct. Only the class name
  `.them` is overloaded. It's renamed in WP-A.

Clutter (same value two or three times on one screen):
- Overview: "What stood out" re-sorts the per-game cards and shows the same numbers again.
- Matches heading: "Every match · 7 matches · 4–3" repeats the scorebug.
- Trends: the period average appears on the tile, as the "avg" line label and in the legend.
  The h3 repeats the selected tile's name.
- Friend page: the scorebug mid repeats the names from the h1, plus win % that can be worked out
  from the two records beside it.
- By playlist: the bar duplicates the win % beside it.
- Best/Worst playlist tiles are the top and bottom rows of the list just below.
- Settings Remarks: the section title, row label and help say the same thing.
- Seasons: the "current" badge and "still running" say the same thing.
- MatchView: the result shows in the title and again on both team headings.

Labels and sense:
- "Ended on W3" is unclear.
- "Best streak" counts win streaks only.
- Bare "Shooting" for goals/shots.
- Delta units: "12%" is relative while "12 pts" is absolute, both with ▲. The 30-day comparison
  has four phrasings.
- Friends landing: "Together" is both a section h2 and a record label.
- The Compare "Without" column includes matches with the friend as an opponent, but only the
  footnote says so. The friends' Win % cells are always "–".
- Recap: three different "aerial" counts and two "long" rules on one page.
- Small samples: win % and deltas show with no match count. A previous period of one match still
  yields "▲ 40 pts" (`logic/trends.ts:260`). Playlist rows with one match show 100%.
- Charts: sparkline min–max scaling makes a 50→51% change fill the tile. The y-axis isn't at
  zero and its ticks aren't round. The two stacked Trends charts have different left padding,
  so a day sits at a different x in each. The "⚑ left early" note shows on non-win-% metrics.

Not a bug, on checking: "Time together · over N matches" counts every match, which is right for
time.

## User decisions (2026-11-03)
1. **Two tile kinds**: `Tile` (centred headline, value over label) and a new `StatCard` (grid,
   label over value), with the same face, label style and colours. This revisits the backlog's
   "one shared Tile": the grid cards carry units, sub lines and selection that a headline tile
   doesn't.
2. **One green/red pair, two steps**:
   - Rule: green/red means good/bad. That covers results, deltas, save, connection and errors.
   - `--win`/`--loss` stay the base (fills).
   - `--up`/`--down` become the lighter text step, derived with `color-mix` from
     `--win`/`--loss`, so a later colour override changes both.
3. **Unknown side on the match page**: no team colour. Headings read "Blue team" / "Orange team".
4. **Scope**: fix the verified bugs now (B1–B3; B4 was dropped by the plan review). The repeated-value, label, small-sample and chart items go to one new
   backlog item to review together, because removing data is a product call per item.

## Colour rule (written as a comment at the top of `tokens.css`)
- blue/orange: your side / the other side. Never a game team colour, never decoration.
- `--friend-a`/`--friend-b`: a friend on your side, in friend order.
- green/red (`--win`/`--loss`, and the text step `--up`/`--down`): good/bad. That covers a result,
  a delta, success/failure and errors.
- `--flag`: a warning or a flagged match.
- `--accent`: selection, focus and the current page. Never data, never decoration.
- Decoration uses neutrals (`--ink`, `--line`) only.

## Plan
Step 0 is a few small chores. The three work packages after it each end green and get their own
commit, and each is roughly one session.

### Step 0
- Write `~/.claude/retros/2026-11-03-deferred.md` (deferred one week).
- Copy this plan to `docs/plans/2026-11-03-display-drift.md`.

### WP-A: colour roles and data bugs (~150 lines)
- `styles/tokens.css`:
  - Add the rule comment above.
  - Set `--up: color-mix(in srgb, var(--win) N%, white)` and the matching `--down`. Pick N so the
    contrast test passes.
  - Replace the hardcoded `#0c1a2b` in Friends with `var(--page)`.
- `pages/recap/MatchView.tsx:128-129`:
  - `TEAM_TONE.blue` and `.orange` become `undefined`.
  - `TEAM_LABEL` becomes "Blue team" / "Orange team".
- Friends class names, with no colour change:
  - In the carry bar and key, `.them`/`.b` become `.friendA`/`.friendB`, along with `SHADES`
    (`zones.tsx:28`).
  - In the against-zone table, `.table .them` becomes `.opp` and stays orange
    (`Friends.module.css:129`, `zones.tsx:308`).
- `ShareCard.module.css`:
  - Line 30: the blue/orange decoration gradient becomes one neutral
    `color-mix(in srgb, var(--ink) 8%, transparent)` glow.
  - Line 16: the `#000a` backdrop becomes `rgb(0 0 0 / .67)`.
- `Friends.module.css` `.sugg` edge: `--flag` becomes `--ink2` (neutral).
- B1: move `overtimeTile`'s note into a pure `overtimeNote(ot)` in `logic/friends.ts`, using w+l
  as the count, and test it.
- B2: move the Diff cell's text and direction into a pure `diffText(d, points)` in
  `logic/friends.ts`. The sign and colour come from the rounded text, and a zero is muted with
  no sign. Test it.
- B3:
  - Add `whole(n)` to `logic/format.ts`, giving `Math.round(n).toLocaleString("en-GB")`.
  - `decimal()` uses it from 100 up.
  - Route the raw JSX numbers through it: `Overview.tsx:203`, `MatchView.tsx:180` and
    `GoalMap.tsx:58,124`.
  - Grep for other `{…total}`, `{….score}` and `String(…)` displays that can reach 1000.
  - Existing tests covering `decimal()` callers (`share-card.ts:78-79`, `trends.ts:243`) may
    need updating.

### WP-B: type and tiles (~250 lines)
- `tokens.css :root`: add `--display: Bahnschrift, "Arial Narrow", "Segoe UI", sans-serif`, plus
  a global `.display` rule in `global.css` (condensed, italic, 800).
- Replace the five copied stacks: Tile, Scorebug, Overview ×2, Trends, Friends `.rv`.
- Size scale, written in the `tokens.css` comment:
  - 96/64 for the scorebug;
  - 30 for a Tile;
  - 28 for a StatCard;
  - 26 inline, for the Trends record and the Friends landing record.
  - Everything is italic 800.
- New `components/StatCard.tsx` and `StatCard.module.css`:
  - Content props: `label`, `icon?`, `value`, `unit?`, `sub?`, `vs?`.
  - `vs` is a ReactNode slot, so Overview's `VsText` (`Overview.tsx:180-188`, with its hidden
    up/down word and the " vs 30-day avg" suffix) and Trends' `DeltaText` pass through
    unchanged.
  - Because Tile is touched, its `vs` also gets the visually-hidden "up"/"down" word
    (`Tile.tsx:20-23`).
  - Trends props: `pressed?` and `onClick?`. With `onClick` it renders a `<button
    aria-pressed>`.
  - `children` is the sparkline slot.
  - The label is uppercase, 12px, `.1em`, `--ink2`. Tile's label moves to the same spec.
- Move onto StatCard:
  - Overview PerGame, Extras and Highlights (`Overview.tsx:199-204, 274-290`, dropping `.stat`);
  - Trends `MetricTiles` (keeping the visually-hidden up/down words).
- Display face only, with no component:
  - MatchView score `h2`;
  - ShareCard record (its own scale stays);
  - Trends `.record`;
  - Friends landing `.rv` (label style aligned too).

### WP-C: headings and shared CSS (~300 lines)
- New `components/Section.tsx`:
  - `<section aria-labelledby>` with a header holding the h2 (16px, sentence case) and an
    optional `aside` slot for a hint or control.
  - An optional `tone: "yours" | "theirs"` draws the blue or orange rule. This is for the Friends
    zones, which drop their uppercase.
- Heading rule:
  - A section h2 sits above its panel.
  - An h3 sits inside a panel only for a sub-block of that panel (team tables, GoalMap halves).
- Apply the rule:
  - Overview: "What stood out" and "By playlist" move above their panels.
  - Trends: chart titles become Sections, with the mode switch or hint in `aside`. This takes the
    W/L hint out of the heading.
  - Settings: its own `Section` (`parts.tsx:52-57`) keeps its id anchor, focus `ref` with
    `tabIndex=-1`, intro, reset and status. It wraps the shared Section, which forwards `id`,
    `headingRef` and `tabIndex` to the h2. 18px becomes 16px, and focus-on-section-link must
    still work (checked by the e2e).
  - Friends: zones and section headings use Section.
- Page h1: visually hidden unless the title is content (friend name, pair, the recap session
  picker). The Friends landing "Friends" h1 and Recap's empty-state "Recap" become hidden.
- `global.css` gets shared `.panel`, `.table` (14px; th 12px 600 `.06em`; cells 6px 8px),
  `.muted` (`--muted`) and `.up`/`.down`.
- Delete the copies in Overview, Matches, MatchView, Trends, Friends, Settings and Tile. Pages
  apply them as global class names, like the existing `num` and `visually-hidden`.
- Override pattern: a page variant is a module class added alongside the global one
  (`cx("table", styles.compare)`), and module rules select `.compare th`. Module rules never
  re-declare the base `.table th`, because equal specificity would then depend on bundle order.
  Existing descendant variants (`.table .sep`, `.table .you`) become `:global(.table) .sep`.
- e2e specs to update:
  - `recap-empty.spec.ts:15` (it asserts a visible "Recap" h1);
  - `settings.spec.ts:30` `[class*=row]` and `settings-tables.spec.ts:180` `[class*=head]`.
    Substring selectors could match new Section classes, so either name the Section header class
    to avoid `head`/`row`, or change those selectors to role-based ones.

### BACKLOG changes (with WP-C's commit)
- Close "Display layer drift across pages" and point to this plan.
- Add **[design, Med, Standard] Data sense review**: every clutter and label item listed above,
  each with its `path:line`, decided one by one with the user.
- Add **[design, Low, Standard] Controls drift**: about six button styles, two segmented controls
  (Trends `.xmode` / Settings `.seg`, buttons vs radios), two `.link` rules, `.chip` vs
  `.picks button`.
- Add **[design, Low, Standard] Trends data line**: it uses `--accent`, which the rule now
  reserves for selection, and on oled it's white like the text. Choose a data colour.
- The Settings › Appearance colour-pairs item is unblocked (each token now has one meaning).

## Error handling and logging
This is display-only work: no new external calls or failure paths. The existing `Loading`,
`EmptyState` and `TableState` handling is moved untouched, so nothing new needs logging.

## Verification
- **Unit (TDD, red first)**:
  - `tokens.test.ts`:
    - `--up`/`--down` are `color-mix` of `--win`/`--loss`;
    - the mixed colour (computed in the test as a channel blend) is ≥ 4.5:1 on every theme's
      `--surf` and `--page`;
    - `--page` text is ≥ 4.5:1 on `--blue`, `--friend-a` and `--friend-b`;
    - no hex colours outside `tokens.css` (grep test across `src/web/**/*.css`).
  - `format.test.ts`: `decimal(12345)` gives "12,345", and 100 and 999.4 are unchanged.
  - `friends.test.ts`: `overtimeNote` with a no-result match; `diffText(0.001)` gives muted with
    no sign.
- **e2e**:
  - Update selectors moved by StatCard and Section.
  - Run `bun run check` and the full `bun run e2e`, plus a 320px run of the recap, trends and
    friends specs.
  - Add a fixture match without the "me" player (side `blue`/`orange`, `logic/recap.ts:245`).
    Assert "Blue team · won" with no tone class, next to the existing "Your team · won"
    (`recap.spec.ts:272`).
- **Real browser**:
  - Run `/run` (dev), then drive with Claude in Chrome.
  - Take before/after screenshots of Recap overview, Matches, a match, Share card, Trends,
    Friends landing, a friend, a pair and Settings.
  - Check at 320, 768 and 1440px on carbon, slate and oled.
  - Confirm no console errors and do a keyboard pass on the Trends cards (still toggle,
    `aria-pressed`).
  - Export a share card PNG and check that `color-mix` and the face render through html-to-image.
- **Review**: `independent-review-pass` per WP diff.

## Plan review
`plan-reviewer` (opus), round 1. Verdict: sound, revise before approval. Each finding, with
what was done:

1. **High**: B4 is not a bug, because the match table's friend is an opponent. *Folded:* B4
   dropped, and the change is now a class rename only (`.friendA`/`.friendB`, `.opp`).
2. **Med**: B3 missed the raw JSX numbers. *Folded:* added `whole()` and listed the call sites.
3. **Med**: the hex test would fail on the `#000a` backdrop. *Folded:* it becomes
   `rgb(0 0 0 / .67)`.
4. **Med**: StatCard `vs: TileVs` would drop the hidden words and the suffix. *Folded:* `vs` is a
   ReactNode, and Tile gains the hidden word.
5. **Med**: the shared Section overlaps the Settings Section. *Folded:* the Settings one wraps the
   shared one, which forwards `id`, ref and `tabIndex`.
6. **Med**: global class overrides, fragile e2e selectors and the hidden Recap h1. *Folded:* the
   override pattern is stated and the specs are listed.
7. **Low**: an accent glow and edge would break the rule. *Folded:* both use neutrals, and the
   rule says decoration is neutral.
8. **Low**: the unknown-side test seam was conditional. *Folded:* a new fixture and an assertion.
9. **Low**: the plan contradicted itself on Time together. *Folded:* the B1 line was fixed.

Checks the reviewer confirmed:
- `color-mix` at `:root` with an override on `<html>` resolves correctly.
- `--page` on `--blue` is 5.36:1.
- html-to-image renders `color-mix`.
- B1 and B2 are confirmed.

## Review log

### WP-A, round 1 (snapshot c239fc4)
Tier: Substantial by design tier (non-test diff about 63 lines). Passes: `/code-review high`,
`arch-reviewer` (opus), `security-reviewer`, `/simplify`.
- security: no findings.
- arch: B3 grep missed the extras "Aerial touches"/"Crossbar hits" `String()` counts. [Fixed]
- arch + code-review: the unknown-side e2e only asserted classes were absent, which passes
  vacuously. [Fixed] Added a positive check that "Your team" is /blue/ and "Opponents" /orange/.
- arch + code-review: the trends-few header said "2 matches" after the seed gained a third. [Fixed]
- code-review: the comment and test name claimed any --win override moves --up; only one on
  :root does (the custom property inherits already computed). [Fixed] Both reworded.
- code-review: `whole(-0.4)` printed "-0". [Fixed] Test first, then `|| 0`.
- code-review: `whole` hard-codes en-GB against the file's "reader's locale". [Fixed] Comment
  says why (it can't clash with decimal()'s "." fractions).
- code-review: `toLocaleString` builds a formatter per call. [Fixed] Uses one module-level `Intl.NumberFormat`.
- code-review: GoalMap `{side.aerial}` left raw next to `whole(side.total)`. [Fixed]
- code-review: `resolve()` re-parsed hex without the 3-digit expansion. [Fixed] There's now a shared
  `channels()` helper with a 3-digit test case.
- code-review: `TEAM_TONE` listed three `undefined` keys. [Fixed] It's now a `Partial` with two keys.
- code-review: `diffText(NaN)` shows a red "−NaN". [Verified, no fix needed] Values come
  zod-validated from JSON, which can't carry NaN, and the With column would show "NaN" first anyway.
- simplify (altitude/simplification): friend counts in `recordText`, `compareNote` and
  `overtimeNote` still used `String()`. [Fixed] Routed through `whole()`. Skipped: a lint ban on
  `String(<number>)` (well outside this diff), dropping the overtime `n` (a server/wire
  change), `diffText` returning a class not a direction, the `text === "0"` coupling,
  `data-side` attributes for the e2e, and grouping small per-match stats.
- e2e: `friends-page.spec.ts:43` failed once in the full run (h1 still "Recap" after clicking
  Friends) and passed 33/33 with `--repeat-each 3`. That spec isn't in this diff. Noted as a flake.
Runs: `bun run check` passes (1161 tests). `bun run e2e`: 80 passed, 1 flaky as above.

### WP-A, round 2 (delta from c239fc4)
Full round because the fixes touched `recap.ts` and `trends-few.spec.ts`, outside the round-1 diff.
Passes: `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`.
- security, arch: no findings.
- code-review (it reviewed the snapshot, not the delta, so it re-raised round-1 items already
  [Fixed]: extras counts, GoalMap aerial, the cached formatter, the :root comment, -0, en-GB, the
  trends-few comment). Its new findings:
  - Friends against-zone match table prints raw per-match scores, so B3 missed `{g.line(m)?.[k]}`. [Fixed]
  - The no-literal-colours test only matched hex, so `rgb()` backdrops slipped past.
    [Fixed] The test now matches `rgb(`/`hsl(` too, red first. New tokens are `--scrim` (dialog
    backdrop) and `--shadow` (SessionPicker popover); both are black on every theme.
  - The Overtime tile hides when every overtime match was a no-result. [Verified, no fix needed]
    This is a deliberate, recorded deviation, and the round-1 arch review judged it sound: "– of 2"
    with a 0–0 record says nothing, and a no-result has no overtime outcome to report.
Runs: `bun run check` passes (1161 tests). `bun run e2e` gives 81 passed (3.8m), with no flake this time.

### WP-A, round 3 (delta: round-2 fixes, snapshot 65b439c)
Full round because the fix touched `SessionPicker.module.css`. Passes: `/code-review high`, `arch-reviewer`
(sonnet), `security-reviewer`.
- security: no findings.
- arch: the colour rule's "decoration uses neutrals" line didn't name `--scrim`/`--shadow`.
  [Fixed] It's a comment-only nit. Hex regex could match an id selector. [Verified, no fix needed]
  None exists, and the fix would be to anchor the regex, not loosen it.
- code-review:
  - `::backdrop` doesn't inherit custom properties before Chrome 122 / Safari 17.4, so
    `var(--scrim)` there is transparent. [Verified, no fix needed] The app runs locally in the
    user's current browser, and a missing dim behind a dialog loses nothing.
  - The literal-colour test missed named colours and modern colour functions. [Fixed] It now also
    matches `hwb/lab/lch/oklab/oklch/color(` and standalone `white`/`black` (not `white-space`).
    It caught a "white" in a Friends comment, which is reworded.
  - The test exempted any file named tokens.css. [Fixed] It now matches the exact glob key
    `./tokens.css`.
  - `scrim`/`shadow` weren't in the `:root` key test. [Fixed]
  - Test name claimed more than CSS. [Fixed] It's now "no literal colours in CSS outside tokens.css".
    TSX has no literals today (grepped).
  - The Friends pager line printed raw numbers. [Fixed] It uses `whole()` now.
  - `g.line(m)` was looked up once per column. [Fixed] It's now hoisted per group.
  - No test holds the zones `whole(v)` call site. [Verified, no fix needed] `whole` is unit-tested, and
    no seed has a 1,000+ score; the other B3 call sites have the same coverage.
  - Hex false positives such as `url(#fade)`. [Verified, no fix needed] This is the same item as the arch one.
Runs: `bun run check` passes (1161 tests). `bun run e2e` gives 81 passed (3.8m).

### WP-A, round 4 (delta from 65b439c)
Passes: `/code-review low`, `security-reviewer`. The arch fix was a comment nit, so arch wasn't re-run. No findings. The review is done.
