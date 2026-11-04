# Display drift WP-A review summary

Date: 2026-11-03. The full log is in the Review log of `docs/plans/2026-11-03-display-drift.md`.

- Tier: Substantial (design tier; about 70 non-test lines). Four rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Rounds 2 and 3 were full rounds, because fixes touched files outside the round-1 diff
  (`recap.ts`, `SessionPicker.module.css`). They ran code-review high, arch (sonnet) and security.
  Round 4 ran code-review low and security. Security found nothing in any round.
- Fixed:
  - B3 reach. These counts now go through `whole()`: the extras "Aerial touches"/"Crossbar hits",
    GoalMap aerial, the friend record/compare/overtime counts, the Friends match table and its pager.
  - `whole()` uses one cached en-GB formatter (a comment says why en-GB), and a negative zero
    prints "0".
  - The no-literal-colours test also matches the `rgb`/`hsl` family, the newer colour functions
    and standalone white/black. Only tokens.css is exempt (exact path). The dialog backdrop and
    popover shadow are now the tokens `--scrim`/`--shadow`.
  - The unknown-side e2e gets a positive check (Your team is blue, Opponents orange), so its
    absent-class checks can fail.
  - The --up/--down comment and test say the override has to be on :root. TEAM_TONE is a two-key
    Partial. The tokens test shares one hex parser.
- No fix needed:
  - `diffText(NaN)`: JSON can't carry NaN.
  - The Overtime tile hides when all overtime matches were no-results. This is a recorded deviation.
  - `::backdrop` custom properties in pre-2024 browsers: the app is local, and nothing is lost.
  - Hex id-selector false positives: none exist yet.
  - No e2e for the zones `whole(v)` call site.
- Flake seen once: `friends-page.spec.ts:43` (h1 still "Recap" after clicking Friends). It passed
  33/33 on repeat and wasn't in this diff.
