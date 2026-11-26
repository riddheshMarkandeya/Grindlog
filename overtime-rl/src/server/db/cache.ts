import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CarBodyType, MatchAnalysisResult, PlayerCardPrefs, SessionRecap } from '../../shared/types.ts';

export class OvertimeDBCache {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const defaultDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const finalPath = dbPath || path.join(defaultDir, 'overtime.db');
    this.db = new DatabaseSync(finalPath);
    this.initSchema();
    this.seedDefaultFriends();
  }

  private seedDefaultFriends(): void {
    try {
      // Remove temporary placeholder
      this.db.prepare('DELETE FROM custom_friends WHERE primary_id = ? OR name = ?').run('custom:hulkpenning', 'hulkpenning');

      const checkStmt = this.db.prepare('SELECT 1 FROM custom_friends WHERE primary_id = ?');
      if (!checkStmt.get('custom:rudeturkey7373')) {
        const insStmt = this.db.prepare('INSERT OR REPLACE INTO custom_friends (primary_id, name, added_at) VALUES (?, ?, ?)');
        insStmt.run('custom:rudeturkey7373', 'RudeTurkey7373', Date.now());
      }
      if (!checkStmt.get('custom:hulkingpen12238')) {
        const insStmt = this.db.prepare('INSERT OR REPLACE INTO custom_friends (primary_id, name, added_at) VALUES (?, ?, ?)');
        insStmt.run('custom:hulkingpen12238', 'HulkingPen12238', Date.now());
      }
    } catch {}
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS match_cache (
        guid TEXT PRIMARY KEY,
        computed_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_cache (
        session_key TEXT PRIMARY KEY,
        computed_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custom_friends (
        primary_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_card_prefs (
        primary_id TEXT PRIMARY KEY,
        car_body TEXT NOT NULL DEFAULT 'octane',
        custom_name TEXT,
        custom_title TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_match_cache_computed ON match_cache(computed_at DESC);
    `);
  }

  public getCardPrefs(primaryId: string): PlayerCardPrefs | null {
    try {
      const row = this.db
        .prepare('SELECT primary_id, car_body, custom_name, custom_title, updated_at FROM player_card_prefs WHERE primary_id = ?')
        .get(primaryId) as PlayerCardPrefs | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  public getAllCardPrefs(): PlayerCardPrefs[] {
    try {
      return this.db
        .prepare('SELECT primary_id, car_body, custom_name, custom_title, updated_at FROM player_card_prefs ORDER BY updated_at DESC')
        .all() as unknown as PlayerCardPrefs[];
    } catch {
      return [];
    }
  }

  public upsertCardPrefs(input: {
    primary_id: string;
    car_body?: CarBodyType;
    custom_name?: string | null;
    custom_title?: string | null;
  }): PlayerCardPrefs {
    const existing = this.getCardPrefs(input.primary_id);
    const next: PlayerCardPrefs = {
      primary_id: input.primary_id,
      car_body: input.car_body ?? existing?.car_body ?? 'octane',
      custom_name: input.custom_name !== undefined ? input.custom_name : (existing?.custom_name ?? null),
      custom_title: input.custom_title !== undefined ? input.custom_title : (existing?.custom_title ?? null),
      updated_at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO player_card_prefs (primary_id, car_body, custom_name, custom_title, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(next.primary_id, next.car_body, next.custom_name ?? null, next.custom_title ?? null, next.updated_at);
    return next;
  }

  public getMatch(guid: string): MatchAnalysisResult | null {
    const stmt = this.db.prepare('SELECT data FROM match_cache WHERE guid = ?');
    const row = stmt.get(guid) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as MatchAnalysisResult;
    } catch {
      return null;
    }
  }

  public saveMatch(analysis: MatchAnalysisResult): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO match_cache (guid, computed_at, data)
      VALUES (?, ?, ?)
    `);
    stmt.run(analysis.guid, analysis.computed_at, JSON.stringify(analysis));
  }

  public getSession(sessionKey: string): SessionRecap | null {
    const stmt = this.db.prepare('SELECT data FROM session_cache WHERE session_key = ?');
    const row = stmt.get(sessionKey) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as SessionRecap;
    } catch {
      return null;
    }
  }

  public saveSession(session: SessionRecap): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_cache (session_key, computed_at, data)
      VALUES (?, ?, ?)
    `);
    stmt.run(session.session_key, Date.now(), JSON.stringify(session));
  }

  public getCustomFriends(): Array<{ primary_id: string; name: string; added_at: number }> {
    try {
      const stmt = this.db.prepare('SELECT primary_id, name, added_at FROM custom_friends ORDER BY added_at DESC');
      return stmt.all() as any;
    } catch {
      return [];
    }
  }

  public toggleCustomFriend(primaryId: string, name: string): boolean {
    const checkStmt = this.db.prepare('SELECT 1 FROM custom_friends WHERE primary_id = ?');
    const exists = checkStmt.get(primaryId);
    if (exists) {
      const delStmt = this.db.prepare('DELETE FROM custom_friends WHERE primary_id = ?');
      delStmt.run(primaryId);
      return false;
    } else {
      const insStmt = this.db.prepare('INSERT INTO custom_friends (primary_id, name, added_at) VALUES (?, ?, ?)');
      insStmt.run(primaryId, name, Date.now());
      return true;
    }
  }

  public isCustomFriend(primaryId: string): boolean {
    try {
      const stmt = this.db.prepare('SELECT 1 FROM custom_friends WHERE primary_id = ?');
      return Boolean(stmt.get(primaryId));
    } catch {
      return false;
    }
  }

  public close(): void {
    this.db.close();
  }
}
