// Schema migrations, one SQL string per version: index + 1 = the version it brings the DB to.
// Append only; never edit a migration that has shipped.
// Timestamps are UTC epoch ms (INTEGER); calendar dates are local `YYYY-MM-DD` (TEXT).

export const trackerMigrations: readonly string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL -- JSON
  );
  CREATE TABLE seasons (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL UNIQUE
  );
  INSERT INTO seasons (name, start_date) VALUES
    ('S22', '2026-03-11'),
    ('S23', '2026-06-09'),
    ('S24', '2026-09-23');
  -- pending: a guess waiting for "That's me" / "Not me"; rejected: never ask about it again.
  CREATE TABLE my_ids (
    primary_id TEXT PRIMARY KEY,
    name       TEXT,
    status     TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'rejected')),
    added_at   INTEGER NOT NULL
  );
  -- Manual "start new session" markers.
  CREATE TABLE session_breaks (
    at INTEGER PRIMARY KEY
  );
  `,
  // Match records: every player gets a row, and "you" is found by joining with my_ids, so
  // confirming an ID re-labels every match without a recompute. No foreign keys: a write deletes
  // a match's child rows itself.
  `
  CREATE TABLE matches (
    guid               TEXT PRIMARY KEY,
    started_at         INTEGER NOT NULL,
    ended_at           INTEGER NOT NULL,
    playlist_id        INTEGER, -- raw id; names come from the playlist map at read time
    arena              TEXT,
    end_kind           TEXT NOT NULL CHECK (end_kind IN ('completed', 'early_end', 'left', 'orphaned')),
    closed_via         TEXT NOT NULL CHECK (closed_via IN ('destroyed', 'timeout', 'restart', 'superseded')),
    joined_in_progress INTEGER NOT NULL,
    overtime           INTEGER NOT NULL,
    score_team0        INTEGER,
    score_team1        INTEGER,
    winner_team_num    INTEGER,
    winner_source      TEXT CHECK (winner_source IN ('match_ended', 'decided')),
    mvp_key            TEXT,
    mvp_source         TEXT CHECK (mvp_source IN ('statfeed', 'inferred')),
    camera_primary_id  TEXT,
    check_flags        TEXT NOT NULL -- JSON array of failed check ids
  );
  CREATE INDEX matches_started_at ON matches (started_at);
  CREATE TABLE match_players (
    match_guid    TEXT NOT NULL,
    player_key    TEXT NOT NULL, -- PrimaryId, or bot:<Name>
    primary_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_bot        INTEGER NOT NULL,
    team_num      INTEGER,
    teams_seen    INTEGER NOT NULL, -- bit 1 << TeamNum per team the player was on
    present_at_end INTEGER NOT NULL,
    score         INTEGER NOT NULL,
    goals         INTEGER NOT NULL,
    shots         INTEGER NOT NULL,
    assists       INTEGER NOT NULL,
    saves         INTEGER NOT NULL,
    touches       INTEGER NOT NULL,
    demos         INTEGER NOT NULL,
    PRIMARY KEY (match_guid, player_key)
  );
  CREATE INDEX match_players_primary_id ON match_players (primary_id);
  CREATE TABLE match_player_statfeed (
    match_guid TEXT NOT NULL,
    player_key TEXT NOT NULL,
    event_name TEXT NOT NULL,
    count      INTEGER NOT NULL,
    PRIMARY KEY (match_guid, player_key, event_name)
  );
  `,
  // Extras: null on a row recorded before this means "not computed" until recompute. Time stats
  // are ms beside car_ms (the time with car state), so shares aggregate across matches.
  `
  ALTER TABLE match_players ADD COLUMN hardest_shot_kmh REAL;
  ALTER TABLE match_players ADD COLUMN woodwork_hits INTEGER;
  ALTER TABLE match_players ADD COLUMN aerial_touches INTEGER;
  ALTER TABLE match_players ADD COLUMN car_ms INTEGER; -- null for a player without car state (opponents)
  ALTER TABLE match_players ADD COLUMN boost_avg REAL;
  ALTER TABLE match_players ADD COLUMN supersonic_ms INTEGER;
  ALTER TABLE match_players ADD COLUMN empty_boost_ms INTEGER;
  CREATE TABLE match_goals (
    match_guid   TEXT NOT NULL,
    idx          INTEGER NOT NULL, -- order in the match
    team_num     INTEGER NOT NULL, -- the scoring team
    scorer_key   TEXT NOT NULL,
    assister_key TEXT,
    toucher_key  TEXT,             -- whose touch the dot sits at; null for an own goal
    x REAL, y REAL, z REAL,        -- ball at that touch, raw field coords; null for an own goal
    distance     REAL,             -- uu to the centre of the goal attacked
    speed_kmh    REAL,
    deflected    INTEGER NOT NULL,
    aerial       INTEGER NOT NULL,
    own_goal     INTEGER NOT NULL,
    PRIMARY KEY (match_guid, idx)
  );
  `,
  // Per-match rule versions, so records computed under older rules can be told apart.
  `
  ALTER TABLE matches ADD COLUMN rule_versions TEXT; -- JSON {ruleId: version} of the rules it was computed under; null before this
  `,
  // Recap remarks: the headline picked per session and filter, kept so a revisit shows the same
  // lines, and every line shown, so the next sessions can avoid repeating it. Lines are ids into
  // the copy pool in code.
  `
  CREATE TABLE remark_picks (
    session_key  TEXT NOT NULL,
    filter       TEXT NOT NULL, -- the filter's query value
    mood_band    TEXT NOT NULL,
    mood_line    TEXT NOT NULL,
    quip_trigger TEXT,          -- null: no quip
    quip_line    TEXT,
    picked_at    INTEGER NOT NULL,
    PRIMARY KEY (session_key, filter)
  );
  CREATE TABLE remark_shown (
    line_id     TEXT NOT NULL,
    session_key TEXT NOT NULL,
    shown_at    INTEGER NOT NULL
  );
  CREATE INDEX remark_shown_session ON remark_shown (session_key, shown_at);
  `,
  // Friends: one PrimaryId each, with an optional nickname; the name otherwise comes from their
  // latest match. Matches aren't touched, so removing a friend keeps them; the removed id goes on
  // the never-suggest list.
  `
  CREATE TABLE friends (
    primary_id TEXT PRIMARY KEY,
    nickname   TEXT,
    added_at   INTEGER NOT NULL
  );
  CREATE TABLE never_suggest (
    primary_id TEXT PRIMARY KEY,
    added_at   INTEGER NOT NULL
  );
  `,
  // App state that isn't a user setting (the settings table only takes keys from the settings
  // schema), e.g. the version whose rules last recomputed every match.
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Counted touches by third from each player's own goal; null until recompute, as for the extras.
  `
  ALTER TABLE match_players ADD COLUMN touches_defence INTEGER;
  ALTER TABLE match_players ADD COLUMN touches_midfield INTEGER;
  ALTER TABLE match_players ADD COLUMN touches_attack INTEGER;
  `,
  // Seasons from the repo's season file. A row remembers the file name it came from, and the start
  // the file last gave it until the user edits it, so a corrected date moves only rows nobody
  // changed. A deleted file season is remembered so the file never brings it back. Seed rows still
  // as seeded are adopted as file rows, so the file can correct them too; a seed season deleted
  // (or renamed) before now counts as dismissed, as the user's change wins.
  `
  ALTER TABLE seasons ADD COLUMN file_name  TEXT; -- the season file's name for this row; null if added by hand
  ALTER TABLE seasons ADD COLUMN file_start TEXT; -- the start the file last set; null once edited by hand
  CREATE UNIQUE INDEX seasons_file_name ON seasons (file_name COLLATE NOCASE);
  CREATE TABLE seasons_dismissed (file_name TEXT PRIMARY KEY COLLATE NOCASE);
  CREATE TEMP TABLE seed (name TEXT, start_date TEXT);
  INSERT INTO seed VALUES ('S22', '2026-03-11'), ('S23', '2026-06-09'), ('S24', '2026-09-23');
  UPDATE seasons SET file_name = name, file_start = start_date WHERE (name, start_date) IN (SELECT name, start_date FROM seed);
  INSERT INTO seasons_dismissed (file_name)
    SELECT name FROM seed WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE seasons.name = seed.name COLLATE NOCASE);
  DROP TABLE seed;
  `,
];

export const rawMigrations: readonly string[] = [
  `
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    match_guid TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    ts         INTEGER NOT NULL,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL, -- JSON
    UNIQUE (match_guid, seq)
  );
  CREATE INDEX events_ts ON events (ts);
  `,
  // What retention decided for each match past the window: thinned (with the dense outputs its
  // thinned events can't give back) or kept whole as exempt.
  `
  CREATE TABLE retention_matches (
    match_guid    TEXT PRIMARY KEY,
    status        TEXT NOT NULL CHECK (status IN ('thinned', 'exempt')),
    decided_at    INTEGER NOT NULL,
    rule_versions TEXT NOT NULL, -- JSON RECORDED_RULE_VERSIONS when decided
    flags         TEXT,          -- exempt: JSON check ids that kept it whole
    outputs       TEXT,          -- thinned: JSON {cameraKey, players: {key: {column: value}}, denseRules}
    states_before INTEGER,
    states_after  INTEGER
  );
  -- No query filters on ts; the index only slows inserts.
  DROP INDEX events_ts;
  `,
];
