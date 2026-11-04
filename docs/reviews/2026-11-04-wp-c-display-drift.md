# Display drift WP-C review summary

Date: 2026-11-04. The full log is in the Review log of `docs/plans/2026-11-03-display-drift.md`.

- Tier: Substantial (design tier; about 360 non-test lines). Three rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 was a full round (a fix touched `DirArrow.tsx`), with code-review high, arch (sonnet)
  and security. Round 3 ran code-review high and security. Security found nothing in any round.
- Fixed:
  - The Matches Total row left-aligned its first three stat cells (`nth-child` counted the
    colspan cell as one).
  - Level-3 Sections had stopped being landmarks everywhere. Every Section is now a named region,
    and `region={false}` opts out where a name repeats (the Friends "By playlist" ×2, and
    "Match by match", whose table box is a region of that name).
  - Round 1 removed `.zone .panel + .panel` as dead, which made the two "Who carries" panels
    touch. Round 2 caught it, the rule is back, and a pair e2e checks the gap.
  - The sticky-nav e2e passed with its offset rule missing. It now jumps to Remarks and asserts
    the heading lands 0–24px under the row. Both new assertions were seen failing without their
    rule, run with a fresh build.
  - The plan is indexed in PROJECT_INDEX, the BACKLOG citation is fixed, and the comments are
    self-contained.
  - A `dirClass` helper was added in round 1 and removed in round 2 (it was a no-op at two sites
    and broke Fast Refresh). DirArrow's doc says the `dir` values are also class names.
- Deferred → BACKLOG: the 56px Settings sticky-row offset with classic scrollbars (Watch list);
  `PeriodControls.tsx:45` `styles.controls` (under Controls drift).
- Disputed: the Trends charts, "Who carries" and "Highlights" being named regions. They restore
  the pre-WP-C Trends landmarks, and each name is unique on its page.
- Skipped as YAGNI: shared `.small`, a Section `panel`/`flush` prop, panel and table variants
  in global.css, one hidden-h1 component.
- Lesson: `bunx playwright test` serves the last `vite build`. Red-check a CSS change with
  `bun run e2e -- <spec>`.
