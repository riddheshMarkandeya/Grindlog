# Context-Aware Match Rating & Analytics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a high-precision, football-inspired match rating and analytics engine with a rolling 5-second spatial history buffer, possession state machine, 5-second counter-press win-back waivers, favorable pass proximity rewards, causal defensive blame rewind, and game-state multipliers.

**Architecture:** A modular pipeline processes `raw.db` and `tracker.db` events through a touch debouncer (<0.35s), possession state machine (`Controlled`/`50-50`/`Loose`), and a causal evaluator module that handles 5s rewind checks, deferred turnover timers, and single-primary-cause conflict resolution before computing FotMob-style ratings (clamped 0.0–10.0).

**Tech Stack:** TypeScript, Node.js (`node:sqlite`), Zod schemas, React 19 / Vite.

**Spec:** [2026-11-25-context-aware-rating-engine-design.md](../specs/2026-11-25-context-aware-rating-engine-design.md)

## Global Constraints
- Every player starts at 6.0 baseline; final score clamped strictly between 0.0 and 10.0 with 1 decimal place.
- Rapid micro-touches (<0.35s apart by the same player) must be debounced into a single possession event.
- Single-Primary-Cause Rule: No overlapping/contradictory negative penalties on the same player for a single conceded goal or error.
- Favorable Pass Proximity Check ($D_{\text{Teammate}} < D_{\text{Opponent}}$) grants +0.45 to +0.60 Prime Chance Created and grants 0.0 fast-break immunity if teammate hesitates and opponents counter.
- 5-Second Win-Back Waiver: Turnovers held for 5.0s; if possession won back within 5.0s, deduct 0.0 and grant +0.15 bonus.
- Zero AI tokens, zero network calls, 100% offline local execution completing in $<35\text{ ms}$ per match.

---

### Task 1: Shared Schemas & Categorized Rating Factors

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/models.test.js`

**Interfaces:**
- Produces: `DebouncedHit`, `PossessionState`, `DeferredTurnoverEvent`, `CausalDefenseBlame`, updated `RatingFactorSchema` with optional `category` and `clutchApplied`.

- [ ] **Step 1: Write failing test in `tests/models.test.js`**
  Add unit assertions verifying that `RatingFactorSchema` parses categorized factors (`attack`, `defense`, `goalkeeping`, `turnover_recovery`, `clutch`) and that new types are exported cleanly.

- [ ] **Step 2: Run test to confirm it fails**
  Run: `node --test tests/models.test.js`

- [ ] **Step 3: Implement schemas in `src/shared/types.ts`**
  Add `RatingFactorCategorySchema = z.enum(['attack', 'defense', 'goalkeeping', 'possession', 'turnover_recovery', 'discipline', 'clutch'])`, add `category` to `RatingFactorSchema`, and add helper types for spatial hits and possession states.

- [ ] **Step 4: Run test to confirm it passes**
  Run: `node --test tests/models.test.js`

---

### Task 2: Touch Debouncer & Possession State Machine

**Files:**
- Create: `src/server/models/possession.ts`
- Test: `tests/possession.test.js`

**Interfaces:**
- Produces: 
  - `groupMicroTouches(hits: RawBallHit[], debounceMs?: number): DebouncedHit[]`
  - `classifyPossessionState(recentHits: DebouncedHit[], windowMs?: number): PossessionState`
  - `isSimultaneous50(hitA: DebouncedHit, hitB: DebouncedHit, thresholdMs?: number): boolean`

- [ ] **Step 1: Write failing test in `tests/possession.test.js`**
  Test that consecutive hits $<350\text{ms}$ by the same player merge into a single hit sequence, and that hits by opposing players within $<400\text{ms}$ are classified as `Contested/50-50`.

- [ ] **Step 2: Run test to confirm it fails**
  Run: `node --test tests/possession.test.js`

- [ ] **Step 3: Implement `possession.ts`**
  Implement `groupMicroTouches`, `classifyPossessionState`, and `isSimultaneous50`.

- [ ] **Step 4: Run test to confirm it passes**
  Run: `node --test tests/possession.test.js`

---

### Task 3: Rolling Buffer & Causal Evaluator

**Files:**
- Create: `src/server/models/causal-evaluator.ts`
- Test: `tests/causal-evaluator.test.js`

**Interfaces:**
- Consumes: `DebouncedHit`, `PossessionState` from `possession.ts`.
- Produces:
  - `evaluatePassDelivery(passer: string, ballTarget: {x, y, z}, players: PlayerPosition[]): { isFavorable: boolean, bonusDelta: number, liabilityPlayer?: string }`
  - `evaluate5sWinBack(turnoverTs: number, hits: DebouncedHit[], losingTeam: number): { wonBack: boolean, elapsedSec: number }`
  - `evaluateDefensiveRewind(goalTs: number, players: PlayerPosition[], hits: DebouncedHit[], concedingTeam: number): CausalDefenseBlame`
  - `evaluateReboundWaiver(saveTs: number, hits: DebouncedHit[], keeperName: string): boolean`

- [ ] **Step 1: Write failing tests in `tests/causal-evaluator.test.js`**
  Test:
  1. Favorable pass ($D_{\text{Teammate}} < D_{\text{Opponent}}$) gives passer immunity and flags hesitating teammate on counter.
  2. 5s Win-back rule detects ball recovered within 5.0s and waives turnover.
  3. Spilled rebound followed by instant clearance within 2.5s waives -0.25 penalty to 0.0.
  4. Spectator defender with near-zero movement receives -0.45 primary blame.

- [ ] **Step 2: Run test to confirm it fails**
  Run: `node --test tests/causal-evaluator.test.js`

- [ ] **Step 3: Implement `causal-evaluator.ts`**
  Implement proximity geometry, deferred timers, 5s rewind trace, and the single-primary-cause resolver.

- [ ] **Step 4: Run test to confirm it passes**
  Run: `node --test tests/causal-evaluator.test.js`

---

### Task 4: Complete Engine Re-Implementation in `rating.ts`

**Files:**
- Modify: `src/server/models/rating.ts`
- Test: `tests/models.test.js` and `tests/rating_engine.test.js`

**Interfaces:**
- Consumes: `causal-evaluator.ts`, `possession.ts`, `types.ts`.
- Produces: `calculatePlayerRating(metrics: PlayerMatchMetrics): PlayerRatingResult` with complete categorized factors, clutch multipliers, and causal bonuses/deductions.

- [ ] **Step 1: Write comprehensive test in `tests/rating_engine.test.js`**
  Test:
  - Long-Range Screamer (+1.40) vs Soft Goal (+0.50).
  - 1-2 Touch Counter Goal (+1.30).
  - Solo Run bypasses $\ge 2$ defenders (+1.50).
  - Tap-in (+0.40) vs Big Chance Missed (-0.30).
  - Clutch multiplier (1.25x in last 60s when score diff $\le 1$).
  - Garbage-time dampener (0.50x in last 30s when diff $\ge 4$).
  - Rating strictly clamped [0.0, 10.0].

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/rating_engine.test.js`

- [ ] **Step 3: Implement full engine in `src/server/models/rating.ts`**
  Integrate all causal factors, 5s win-back recoveries, rebound clear waivers, favorable pass bonuses, and game-state multipliers.

- [ ] **Step 4: Run test to confirm it passes**
  Run: `node --test tests/rating_engine.test.js`

---

### Task 5: Match Analyzer Pipeline Integration

**Files:**
- Modify: `src/server/models/analyzer.ts`
- Test: `tests/analyzer.test.js`

**Interfaces:**
- Consumes: `calculatePlayerRating`, `causal-evaluator.ts`, `grindlog-reader.ts`.
- Produces: `MatchAnalysisResult` containing full causal ratings, debounced touches, Hockey Assists, Tactical Demos, and Press Resistance.

- [ ] **Step 1: Write assertions in `tests/analyzer.test.js`**
  Verify that historical replay analysis correctly runs through the causal pipeline and finishes in $<35\text{ ms}$.

- [ ] **Step 2: Run test to verify requirements**
  Run: `node --test tests/analyzer.test.js`

- [ ] **Step 3: Wire pipeline in `analyzer.ts`**
  Feed `raw.db` `BallHit` and `StatfeedEvent` through the debouncer and causal evaluator, compute pre-assists, tactical demos, and pass favorable delivery ratios.

- [ ] **Step 4: Run test to confirm it passes**
  Run: `node --test tests/analyzer.test.js`

---

### Task 6: UI Presentation & Factor Breakdown

**Files:**
- Modify: `src/web/components/RatingModal.tsx`
- Modify: `src/web/components/CoachReportCard.tsx`
- Build & Verify: `npm run build && npm test`

- [ ] **Step 1: Update `RatingModal.tsx`**
  Group rating factors by category (`Attacking & xG`, `Defending & Duels`, `Passing & Creation`, `Goalkeeping`, `Turnovers & Discipline`) with clean badges indicating clutch multipliers.

- [ ] **Step 2: Build bundle**
  Run: `npm run build`

- [ ] **Step 3: Run full automated test suite**
  Run: `npm test`

- [ ] **Step 4: Verify live server**
  Verify live response at `http://127.0.0.1:49200`.
