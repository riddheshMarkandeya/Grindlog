# OvertimeRL — System Design Specification
**Date:** 2026-11-25  
**Topic:** OvertimeRL (FotMob & SofaScore Style Analytics for Rocket League)  
**Status:** Approved & Calibrated against Grindlog Live Telemetry  
**Target Directory:** `./overtime-rl`

---

## 1. Executive Summary

**OvertimeRL** is a standalone, local-first Rocket League analytics platform inspired by the visual polish, depth, and clarity of **FotMob** and **SofaScore**. 

While existing trackers rely on Psyonix's in-game point score (which inflates ball-chasing and ignores defensive anchors), OvertimeRL introduces:
1. **The 1.0 – 10.0 FotMob Match Rating**: An objective, event-weighted performance score for every player with itemized breakdown transparency and team-outcome calibration.
2. **Expected Goals ($xG$) & Shot Quality Engine**: Geometric and velocity-based probability calculations per shot, tracking "Big Chances Missed" (BCM), "Big Chances Created" (BCC), and clinical finishing.
3. **The SofaScore Momentum Wave**: A 5-minute + overtime territorial pressure timeline showing field tilt and critical event pins derived from hit-sampled telemetry.
4. **SofaScore 6-Axis Player Radars**: Calibrated tactical profiling mapping Finishing, Creation, Defense, Motor, Physicality, and Boost IQ to player archetypes using benchmark anchors.
5. **Session Leaderboard ("Player of the Night") & Discord Share Cards**: Post-grind podiums and exportable 2v2/3v3 lineup cards for party banter.

OvertimeRL runs as a companion to Grindlog, reading raw match ticks and match tables directly from Grindlog's local SQLite store with zero port conflicts.

---

## 2. Architecture & Data Ingestion

```
  ┌────────────────────────────────────────────────────────┐
  │                 Rocket League Client                   │
  └──────────────────────────┬─────────────────────────────┘
                             │ (Stats API WebSocket)
  ┌──────────────────────────▼─────────────────────────────┐
  │                 Grindlog Background                    │
  │     (Writes tracker.db, raw.db & emits SSE events)     │
  └─────────────┬───────────────────────────┬──────────────┘
                │ SQLite (mode: readonly)   │ SSE (/api/events)
  ┌─────────────▼───────────────────────────▼──────────────┐
  │             OvertimeRL Backend (:49200)                │
  │  • Two-Tier Hybrid Ingestion (grindlog-reader.ts)      │
  │  • Analytics Engine (xG, 1.0–10.0 Rating, Momentum)    │
  │  • Local SQLite Cache (overtime.db for fast loads)     │
  │  • REST & SSE API Endpoints                            │
  └──────────────────────────┬─────────────────────────────┘
                             │ JSON / SSE
  ┌──────────────────────────▼─────────────────────────────┐
  │            OvertimeRL Web Frontend (Vite)              │
  │  • FotMob Match Center (Lineups, Ratings, Momentum)    │
  │  • SofaScore Player Radars & Session Leaderboard       │
  │  • One-Click High-Res Discord Lineup Card Export       │
  └────────────────────────────────────────────────────────┘
```

### 2.1 Two-Tier Hybrid Ingestion Strategy

To ensure sub-20ms match load times and avoid memory thrashing on large databases:

1. **Tier 1 — Instant Summary Ingestion (`tracker.db`)**:
   * Path: `%LOCALAPPDATA%\Grindlog\tracker.db`
   * Tables: `matches`, `match_players`, `match_goals`, `seasons`
   * **Pre-Aggregated Metrics**: Leverages Grindlog's pre-computed columns in `match_players`:
     * `car_ms`, `boost_avg`, `supersonic_ms`, `empty_boost_ms`
     * `touches_defence`, `touches_midfield`, `touches_attack`
     * `hardest_shot_kmh`, `woodwork_hits`, `aerial_touches`, `demos`
   * Query Latency: $< 5\text{ ms}$

2. **Tier 2 — Surgical Event Ingestion (`raw.db`)**:
   * Path: `%LOCALAPPDATA%\Grindlog\raw.db`
   * Table: `events` (Columns: `id`, `match_guid`, `seq`, `ts`, `name`, `data`)
   * **Targeted Query**: Never scans full tables. Queries strictly required event types:
     ```sql
     SELECT seq, ts, name, data FROM events 
     WHERE match_guid = ? AND name IN ('BallHit', 'StatfeedEvent', 'CrossbarHit', 'GoalScored')
     ORDER BY seq ASC;
     ```
   * Extracts contact coordinates $(X, Y, Z)$ and velocities for $xG$ and Momentum calculations.

3. **Concurrency & Locking**:
   * Both databases opened with URI parameters: `mode=ro` and `busy_timeout=3000`.
   * Guarantees zero write locks or interference with Grindlog's active writing.

4. **Live Match Detection**:
   * Listens to Grindlog's SSE endpoint: `http://127.0.0.1:49100/api/events`.
   * On receiving `event: match_ended` with payload `{"guid": "<GUID>", "sessionKey": "..."}`, OvertimeRL immediately triggers background analysis and writes results to `overtime.db`.
   * Fallback: If SSE is unreachable, polls `tracker.db` modification timestamp every 3 seconds.

5. **Retention & Boxscore Fallback Mode**:
   * Grindlog manages database growth via `retention_matches` (which thins raw ticks for older matches).
   * OvertimeRL immediately computes and persists computed metrics into `overtime.db` so historical data is never lost.
   * If a match in `tracker.db` has had its `raw.db` events thinned, OvertimeRL automatically activates **Boxscore Fallback Mode**, computing ratings and radars strictly from `tracker.db`'s pre-aggregated metrics.

---

## 3. Mathematical & Analytical Models

### 3.1 Expected Goals ($xG$) & Shot Quality Engine (`src/server/models/xg.ts`)

Every shot is modeled through a geometric and kinetic logit function:

1. **Target Goal Mouth Geometry**:
   * Standard pitch length: $Y \in [-5120, +5120]$.
   * Blue Team (Team 0) attacks Orange Goal at $Y = +5120$. Goal posts: $(-892.14, 5120)$ and $(+892.14, 5120)$.
   * Orange Team (Team 1) attacks Blue Goal at $Y = -5120$. Goal posts: $(-892.14, -5120)$ and $(+892.14, -5120)$.
   * Goal Center: $(0, \pm 5120, 321.39)$.

2. **Metric Derivations**:
   * **Euclidean Distance ($D$)**: 3D distance from ball contact point $(x, y, z)$ to attacked goal center.
   * **Goal Aperture Angle ($\theta$)**: Visible angle of the goal mouth subtended at ball location $(x, y)$, strictly calculated in **radians** ($\theta \in [0, \pi]$):
     $$\theta = \arccos\left(\frac{\vec{v}_1 \cdot \vec{v}_2}{\|\vec{v}_1\| \|\vec{v}_2\|}\right)$$
     where $\vec{v}_1 = (\text{Post}_L - x, \text{Post}_Y - y)$ and $\vec{v}_2 = (\text{Post}_R - x, \text{Post}_Y - y)$.
   * **Post-Hit Speed ($V$)**: Speed in $\text{km/h}$ from `BallHit.Ball.PostHitSpeed`.

3. **Logit & Probability Formula**:
   $$\text{Logit} = -0.85 - (0.00062 \times D) + (1.25 \times \theta) + (0.015 \times V)$$
   $$xG = \frac{1}{1 + e^{-\text{Logit}}}$$

4. **Event Correlation & Matching**:
   * **Goals**: Extracted directly from `match_goals` (`x, y, z, distance, speed_kmh`).
   * **Shots on Goal**: Identified by `StatfeedEvent` (`EventName: 'Shot'`). Linked to the nearest preceding `BallHit` by `MainTarget.Name` within $[-3000\text{ ms}, +500\text{ ms}]$ to extract coordinates and post-hit velocity.

5. **Advanced Shot Classifications**:
   * **Big Chance**: Any shot with $xG \ge 0.45$.
   * **Big Chance Missed (BCM)**: Any shot with $xG \ge 0.45$ that is saved, hits woodwork, or misses without resulting in a goal.
   * **Big Chance Created (BCC)**: Awarded to a player whose Key Pass (touch within 3.0s before a teammate shot) results in a shot with $xG \ge 0.45$.
   * **Clinicality Rating**: $\text{Goals Scored} - \sum xG$. (Positive value reflects clutch/clinical finishing above expected volume).

---

### 3.2 The 1.0 – 10.0 FotMob Match Rating Algorithm (`src/server/models/rating.ts`)

Every player starts at a **6.00 baseline**. The score dynamically adjusts based on weighted match contributions and team context, clamped strictly to $[1.0, 10.0]$:

```typescript
export interface RatingFactor {
  name: string;
  delta: number;
}

export interface PlayerRatingResult {
  score: number; // Clamped to [1.0, 10.0], formatted to 1 decimal place
  factors: RatingFactor[];
}
```

#### Attacking Adjustments
* **Goal**: $+0.60 + (0.40 \times (1 - xG))$ *(rewards low-xG bangers and solo efforts)*
* **Assist**: $+0.50$
* **Key Pass**: $+0.25$ *(touch preceding a teammate shot within 3.0s)*
* **Big Chance Created (BCC)**: $+0.25$
* **Hardest Shot $\ge 100\text{ km/h}$**: $+0.15$

#### Defending Adjustments
* **Save**: $+0.45$
* **Clearance**: $+0.15$ *(defensive third touch crossing into midfield/attack)*
* **50/50 Duel Won**: $+0.10$ per net won *(two opposing `BallHit` events within $\le 120\text{ ms}$ where subsequent touch or ball trajectory favors player's team)*
* **Clean Sheet**: $+0.35$ *(for winning side with 0 goals conceded)*

#### Pace, Motor & Physicality Adjustments
* **Supersonic Share**: Up to $+0.30$ based on `supersonic_ms / car_ms`
* **Demolition Dealt**: $+0.10$ per demo

#### Match Outcome & Team Calibration
* **Match Win (Regulation)**: $+0.25$
* **Match Win (Overtime)**: $+0.15$
* **Match Loss**: $-0.25$
* **Team Concession Penalty**: $-0.20$ per goal conceded by the team

#### Negative Adjustments (Penalties)
* **Own Goal**: $-1.50$
* **Big Chance Missed (BCM)**: $-0.35$
* **Boost Starvation**: $-0.25$ *(`empty_boost_ms / car_ms > 0.15`)*
* **Turnover Concession**: $-0.35$ *(defensive third touch within 2.5s immediately preceding an opponent goal)*

* **Normalization**: For matches terminated early by forfeit, volume metrics are normalized to standard 5:00 regulation ($300{,}000\text{ ms}$) using `car_ms`.

---

### 3.3 Match Momentum Wave Slicer (`src/server/models/momentum.ts`)

The Momentum Wave tracks field tilt and game dominance across the match:

1. **Time Slicing**: Match is partitioned into **10-second buckets** across regulation and overtime.
2. **Hit-Sampled Field Tilt**:
   * Evaluates average ball $Y$-coordinate ($\bar{Y}$) across all `BallHit`, `CrossbarHit`, and `GoalScored` events within each 10-second window.
   * If a bucket contains no touches (ball airborne during aerial play or kickoff countdown), $\bar{Y}$ is linearly interpolated from adjacent buckets.
3. **Touch Dominance Ratio**:
   * Ratio of touches between Team 0 ($T_0$) and Team 1 ($T_1$) within the slice:
     $$\text{TouchRatio} = \frac{T_0 - T_1}{\max(1, T_0 + T_1)}$$
4. **Unified Momentum Formula**:
   $$M = 0.60 \times \left(\frac{\bar{Y}}{5120} \times 100\right) + 0.40 \times (\text{TouchRatio} \times 100) \quad \in [-100, +100]$$
5. **Timeline Event Pins**: Exact timestamps pinned on the wave:
   * ⚽ **Goal** (`GoalScored`)
   * 🧤 **Save** (`StatfeedEvent` - Save / Epic Save)
   * 🥅 **Woodwork** (`CrossbarHit` / `woodwork_hits`)
   * 💥 **Demolition** (`StatfeedEvent` - Demolition)

---

### 3.4 SofaScore 6-Axis Player Radar (`src/server/models/radar.ts`)

Calculates a normalized score ($0–100$) across 6 tactical dimensions using calibrated Rocket League benchmark envelopes:

1. **Finishing**: Goals/5min ($0 - 2.5$), shooting conversion % ($0\% - 40\%$), clinicality ($\pm 1.0$).
2. **Creation**: Key passes ($0 - 5$), assists/5min ($0 - 2.0$), midfield touch % ($\ge 35\%$).
3. **Defense**: Saves/5min ($0 - 3.5$), clearances ($0 - 8$), turnover concessions ($0$).
4. **Motor**: Supersonic time share ($10\% - 35\%$), total field mileage.
5. **Physicality**: Demolitions dealt ($0 - 4$), 50/50 duels won % ($40\% - 80\%$).
6. **Boost IQ**: Average boost maintained ($35\% - 75\%$), starvation time ($<10\%$).

* **Tactical Archetypes**:
  * High Finishing + High Pace $\rightarrow$ *"The Striker"*
  * High Creation + Midfield touches $\rightarrow$ *"The Playmaker"*
  * High Defense + High Boost IQ $\rightarrow$ *"The Anchor"*
  * High Physicality + High Sprints $\rightarrow$ *"The Disruptor"*
  * Balanced $\ge 70$ across all 6 axes $\rightarrow$ *"The All-Rounder"*

---

## 4. Frontend Architecture & Design System

### 4.1 Visual Tokens (FotMob Dark Theme)
* **Backgrounds**: Pitch Slate (`#0b0f17`), Surface Card (`#121824`), Elevated Sub-card (`#1a2234`), Pitch Line Green (`#064e3b`).
* **Rating Colors (FotMob Standard)**:
  * 🟢 **8.0 – 10.0**: Emerald (`#10b981`)
  * 🔵 **7.0 – 7.9**: Teal (`#14b8a6`)
  * ⚪ **6.0 – 6.9**: Slate (`#94a3b8`)
  * 🟠 **5.0 – 5.9**: Amber (`#f59e0b`)
  * 🔴 **< 5.0**: Crimson (`#ef4444`)

### 4.2 Views & Information Architecture
1. **FotMob Match Center (`/match/:guid`)**:
   * **Match Header**: Scoreboard, team logos/colors, overtime duration, playlist badge, team average ratings.
   * **Momentum Pressure Wave**: Interactive dual-color timeline with hover tooltips and event marker pins.
   * **Tab 1: Lineups & Ratings**: 2D pitch formation with clickable rating pills opening the Itemized Breakdown Modal.
   * **Tab 2: xG Shot Map**: 2D pitch showing shot origins sized by $xG$ and color-coded by outcome (Goal 🟢, Saved 🔵, Woodwork 🟡, Missed 🔴).
   * **Tab 3: Tale of the Tape**: Side-by-side comparative bars ($xG$, Field Tilt %, Big Chances, 50/50s won, Clears, Boost Stolen).
   * **Tab 4: Match Awards**: Player of the Match (highest rating), The Sniper (highest clinicality), The Iron Wall (most saves/clears), Crossbar Magnet.
2. **Session Recap & Leaderboard (`/session/:id`)**:
   * **Podium**: "Player of the Night" (POTN) 1st, 2nd, and 3rd place podium with average ratings and win rates.
   * **Session Form Strip**: Visual match badges: `[W 8.4]` `[W 7.3]` `[L 6.1]`.
   * **One-Click Discord Card Generator**: High-resolution 1200x630 lineup card rendered via HTML5 Canvas for instant copy-paste into Discord.
3. **Player Profile & Chemistry (`/player/:id`)**:
   * **6-Axis Radar Hexagon**: Interactive tactical profile with Archetype badge.
   * **Form Graph**: 20-match rolling rating timeline.
   * **Synergy Matrix**: Win rate and combined goal differential when paired with specific friends.

---

## 5. Directory & File Organization

```
./overtime-rl/
├── src/
│   ├── server/
│   │   ├── main.ts              # Bun HTTP server entry (:49200)
│   │   ├── db/
│   │   │   ├── schema.ts        # overtime.db SQLite schema
│   │   │   └── cache.ts         # Fast-read queries and persistence
│   │   ├── ingestion/
│   │   │   ├── grindlog-reader.ts # Hybrid 2-tier SQLite reader (tracker.db + raw.db)
│   │   │   └── sse-client.ts    # SSE listener for live match_ended events
│   │   ├── models/
│   │   │   ├── xg.ts            # Geometric & velocity Expected Goals calculator
│   │   │   ├── rating.ts        # 1.0–10.0 Rating algorithm & factor explanations
│   │   │   ├── momentum.ts      # Hit-sampled 10s field tilt generator
│   │   │   └── radar.ts         # 6-axis player profile & archetype classifier
│   │   └── api/
│   │       ├── match.ts         # /api/match/:guid endpoint
│   │       ├── session.ts       # /api/session/:id endpoint
│   │       └── player.ts        # /api/player/:id endpoint
│   ├── web/
│   │   ├── index.html
│   │   ├── App.tsx              # Shell, navigation, routing
│   │   ├── pages/
│   │   │   ├── MatchCenter.tsx  # Match Center with 4 tabs
│   │   │   ├── SessionRecap.tsx # Session Recap & Podium
│   │   │   └── PlayerProfile.tsx# Player Radar & Form
│   │   ├── components/
│   │   │   ├── RatingBadge.tsx  # Dynamic colored rating pills
│   │   │   ├── RatingModal.tsx  # Itemized point breakdown modal
│   │   │   ├── MomentumGraph.tsx# Dual-color pressure wave
│   │   │   ├── ShotMap.tsx      # 2D pitch with xG shot bubbles
│   │   │   ├── RadarChart.tsx   # SofaScore 6-axis SVG hexagon
│   │   │   ├── TaleOfTape.tsx   # Side-by-side comparative bars
│   │   │   └── DiscordExport.tsx# Canvas-based 1200x630 share card
│   │   └── styles/
│   │       └── theme.css        # FotMob dark theme tokens
│   └── shared/
│       └── types.ts             # Shared TypeScript schemas (Zod validated)
├── tests/
│   ├── xg.test.ts               # Unit tests verifying xG curves
│   ├── rating.test.ts           # Rating algorithm clamping & factor verification
│   └── momentum.test.ts         # Momentum slicer test with sample hits
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 6. Implementation Phasing & Milestones

* **Phase 1: Project Scaffolding & Ingestion Pipeline**:
  * Initialize Bun + Vite project with TypeScript and Zod schemas.
  * Implement `grindlog-reader.ts` (two-tier hybrid reader with read-only SQLite connections).
  * Implement `sse-client.ts` to listen to Grindlog's live `:49100/api/events`.
* **Phase 2: Core Analytical Engines & Unit Tests**:
  * Implement `xg.ts` (radian-locked geometric & speed logit).
  * Implement `rating.ts` (calibrated 1.0–10.0 FotMob rating engine).
  * Implement `momentum.ts` (hit-sampled 10s window slicer).
  * Implement `radar.ts` (6-axis calibrated benchmark radials).
  * Write and verify comprehensive unit test suite in `tests/`.
* **Phase 3: Persistence & REST API**:
  * Create `overtime.db` schema and cache layer.
  * Build REST endpoints (`/api/match/:guid`, `/api/session/:id`, `/api/player/:id`).
  * Verify end-to-end processing of real historical matches from user's `tracker.db`.
* **Phase 4: FotMob Web Match Center**:
  * Build React frontend shell with FotMob dark theme.
  * Implement Match Center view: Lineups, Rating pills, Itemized breakdown modal, Momentum Wave, and Shot Map.
* **Phase 5: SofaScore Radars, Podium & Discord Share**:
  * Implement Session Recap with "Player of the Night" podium.
  * Implement 6-Axis Radar chart and Player Profile.
  * Implement HTML5 Canvas Discord Card generator for instant 1-click clipboard export.
