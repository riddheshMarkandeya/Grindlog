import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

export interface RawEventRecord {
  seq: number;
  ts: number;
  name: string;
  data: any;
}

export interface TrackerMatch {
  guid: string;
  started_at: number;
  ended_at: number;
  playlist_id: number | null;
  arena: string | null;
  end_kind: string;
  overtime: number;
  score_team0: number;
  score_team1: number;
  winner_team_num: number | null;
  mvp_key: string | null;
  camera_primary_id: string | null;
}

export interface TrackerMatchPlayer {
  match_guid: string;
  player_key: string;
  primary_id: string;
  name: string;
  is_bot: number;
  team_num: number;
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  hardest_shot_kmh: number | null;
  woodwork_hits: number | null;
  aerial_touches: number | null;
  car_ms: number | null;
  boost_avg: number | null;
  supersonic_ms: number | null;
  empty_boost_ms: number | null;
  touches_defence: number | null;
  touches_midfield: number | null;
  touches_attack: number | null;
}

export interface TrackerMatchGoal {
  match_guid: string;
  idx: number;
  team_num: number;
  scorer_key: string | null;
  assister_key: string | null;
  toucher_key: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  distance: number | null;
  speed_kmh: number | null;
  deflected: number;
  aerial: number;
  own_goal: number;
}

export class GrindlogReader {
  private trackerDbPath: string;
  private rawDbPath: string;

  constructor(customTrackerPath?: string, customRawPath?: string) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.trackerDbPath = customTrackerPath || path.join(localAppData, 'Grindlog', 'tracker.db');
    this.rawDbPath = customRawPath || path.join(localAppData, 'Grindlog', 'raw.db');
  }

  public isAvailable(): boolean {
    return fs.existsSync(this.trackerDbPath);
  }

  private openTracker(): DatabaseSync {
    return new DatabaseSync(this.trackerDbPath, { readOnly: true });
  }

  private openRaw(): DatabaseSync | null {
    if (!fs.existsSync(this.rawDbPath)) return null;
    return new DatabaseSync(this.rawDbPath, { readOnly: true });
  }

  public getRecentMatches(limit: number = 30): TrackerMatch[] {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`
        SELECT guid, started_at, ended_at, playlist_id, arena, end_kind,
               overtime, score_team0, score_team1, winner_team_num, mvp_key, camera_primary_id
        FROM matches
        ORDER BY started_at DESC
        LIMIT ?
      `);
      return stmt.all(limit) as unknown as TrackerMatch[];
    } finally {
      db.close();
    }
  }

  public getRecentMatchesWithFriends(friendPrimaryIds: string[], limit: number = 30): TrackerMatch[] {
    if (!friendPrimaryIds || friendPrimaryIds.length === 0) return [];
    const db = this.openTracker();
    try {
      const placeholders = friendPrimaryIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT DISTINCT m.guid, m.started_at, m.ended_at, m.playlist_id, m.arena, m.end_kind,
               m.overtime, m.score_team0, m.score_team1, m.winner_team_num, m.mvp_key, m.camera_primary_id
        FROM matches m
        JOIN match_players p_user ON m.guid = p_user.match_guid AND p_user.primary_id IN (SELECT primary_id FROM my_ids WHERE status = 'confirmed')
        JOIN match_players p_friend ON m.guid = p_friend.match_guid AND p_friend.primary_id IN (${placeholders})
        WHERE p_user.team_num = p_friend.team_num
        ORDER BY m.started_at DESC
        LIMIT ?
      `);
      return stmt.all(...friendPrimaryIds, limit) as unknown as TrackerMatch[];
    } catch (err) {
      console.error('Error fetching matches with friends:', err);
      return [];
    } finally {
      db.close();
    }
  }

  public getGrindlogFriends(): Array<{ primary_id: string; nickname: string | null; added_at: number }> {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`SELECT primary_id, nickname, added_at FROM friends`);
      return stmt.all() as any;
    } catch {
      return [];
    } finally {
      db.close();
    }
  }

  public getMatch(guid: string): TrackerMatch | null {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`
        SELECT guid, started_at, ended_at, playlist_id, arena, end_kind,
               overtime, score_team0, score_team1, winner_team_num, mvp_key, camera_primary_id
        FROM matches
        WHERE guid = ?
      `);
      const row = stmt.get(guid);
      return (row as unknown as TrackerMatch) || null;
    } finally {
      db.close();
    }
  }

  public getMyPlayerIds(): Set<string> {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`SELECT primary_id FROM my_ids WHERE status = 'confirmed'`);
      const rows = stmt.all() as Array<{ primary_id: string }>;
      return new Set(rows.map(r => r.primary_id));
    } catch {
      return new Set();
    } finally {
      db.close();
    }
  }

  public getMatchPlayers(guid: string): TrackerMatchPlayer[] {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`
        SELECT match_guid, player_key, primary_id, name, is_bot, team_num,
               score, goals, shots, assists, saves, touches, demos,
               hardest_shot_kmh, woodwork_hits, aerial_touches, car_ms,
               boost_avg, supersonic_ms, empty_boost_ms, touches_defence,
               touches_midfield, touches_attack
        FROM match_players
        WHERE match_guid = ?
      `);
      return stmt.all(guid) as unknown as TrackerMatchPlayer[];
    } finally {
      db.close();
    }
  }

  public getMatchGoals(guid: string): TrackerMatchGoal[] {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`
        SELECT match_guid, idx, team_num, scorer_key, assister_key,
               toucher_key, x, y, z, distance, speed_kmh, deflected, aerial, own_goal
        FROM match_goals
        WHERE match_guid = ?
        ORDER BY idx ASC
      `);
      return stmt.all(guid) as unknown as TrackerMatchGoal[];
    } finally {
      db.close();
    }
  }

  public getPrimaryUser(): { primary_id: string; name: string } | null {
    const db = this.openTracker();
    try {
      const stmt = db.prepare(`SELECT primary_id, name FROM my_ids WHERE status = 'confirmed' LIMIT 1`);
      const row = stmt.get() as { primary_id: string; name: string } | undefined;
      if (row) return row;
      const fallback = db.prepare(`SELECT primary_id, name FROM my_ids LIMIT 1`).get() as { primary_id: string; name: string } | undefined;
      return fallback || null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  public getPlayerMatches(primaryIdOrName: string): Array<TrackerMatchPlayer & {
    started_at: number;
    playlist_id: number | null;
    arena: string | null;
    overtime: number;
    score_team0: number;
    score_team1: number;
    winner_team_num: number | null;
    team_size?: number;
  }> {
    const db = this.openTracker();
    try {
      const cleanedName = primaryIdOrName.startsWith('custom:') ? primaryIdOrName.slice(7) : primaryIdOrName;
      const byPidStmt = db.prepare(`
        SELECT mp.*, m.started_at, m.playlist_id, m.arena, m.overtime,
               m.score_team0, m.score_team1, m.winner_team_num,
               (SELECT COUNT(*) FROM match_players mp2 WHERE mp2.match_guid = m.guid AND mp2.team_num = mp.team_num AND mp2.is_bot = 0) as team_size
        FROM match_players mp
        JOIN matches m ON mp.match_guid = m.guid
        WHERE mp.primary_id = ?
        ORDER BY m.started_at DESC
      `);
      const byPid = byPidStmt.all(primaryIdOrName) as any[];
      if (byPid.length > 0) return byPid;

      const byNameStmt = db.prepare(`
        SELECT mp.*, m.started_at, m.playlist_id, m.arena, m.overtime,
               m.score_team0, m.score_team1, m.winner_team_num,
               (SELECT COUNT(*) FROM match_players mp2 WHERE mp2.match_guid = m.guid AND mp2.team_num = mp.team_num AND mp2.is_bot = 0) as team_size
        FROM match_players mp
        JOIN matches m ON mp.match_guid = m.guid
        WHERE LOWER(mp.name) = LOWER(?) AND mp.is_bot = 0
        ORDER BY m.started_at DESC
      `);
      return byNameStmt.all(cleanedName) as any;
    } finally {
      db.close();
    }
  }

  /**
   * Surgically retrieves raw events for a match without reading large UpdateState ticks.
   */
  public getSurgicalRawEvents(guid: string): RawEventRecord[] {
    const raw = this.openRaw();
    if (!raw) return [];
    try {
      const stmt = raw.prepare(`
        SELECT seq, ts, name, data
        FROM events
        WHERE match_guid = ? AND name IN ('BallHit', 'StatfeedEvent', 'CrossbarHit', 'GoalScored', 'BoostPickup')
        ORDER BY seq ASC
      `);
      const rows = stmt.all(guid) as Array<{ seq: number; ts: number; name: string; data: string }>;
      return rows.map(r => ({
        seq: r.seq,
        ts: r.ts,
        name: r.name,
        data: JSON.parse(r.data),
      }));
    } catch (e) {
      console.warn(`[GrindlogReader] Failed to query raw.db events for match ${guid}:`, e);
      return [];
    } finally {
      raw.close();
    }
  }
}
