import http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { GrindlogReader } from './ingestion/grindlog-reader.ts';
import { GrindlogSSEClient } from './ingestion/sse-client.ts';
import { MatchAnalyzer } from './models/analyzer.ts';
import { buildPlayerProfile } from './models/profile.ts';
import { buildSquadFriendsStats, buildDuoFriendDossier, buildTrioSquadDossier, buildSquadExplorerMatches } from './models/squad.ts';
import { buildSessionPodium, computeSessionTeamTotals } from './models/session.ts';
import { buildPlayerFifaCard, DEFAULT_CARD_CYCLE_SIZE } from './models/fifa-card.ts';
import { OvertimeDBCache } from './db/cache.ts';
import { PlayerCardPrefsUpdateSchema, type MatchAnalysisResult, type SessionRecap, type SessionMatchSummary } from '../shared/types.ts';

const PORT = 49200;

const reader = new GrindlogReader();
const cache = new OvertimeDBCache();
const analyzer = new MatchAnalyzer(reader, cache);
const sseClient = new GrindlogSSEClient();

// In-memory list of connected web browser clients for SSE
const webClients: Set<http.ServerResponse> = new Set();

sseClient.on('match_ended', data => {
  console.log(`[OvertimeRL] Live match ended detected: ${data.guid}`);
  // Asynchronously compute and cache match
  try {
    const analysis = analyzer.analyzeMatch(data.guid, true);
    if (analysis) {
      console.log(`[OvertimeRL] Match ${data.guid} computed and cached.`);
      // Broadcast to all connected browser clients
      const message = `event: match_updated\ndata: ${JSON.stringify({ guid: data.guid })}\n\n`;
      for (const client of webClients) {
        client.write(message);
      }
    }
  } catch (err) {
    console.error(`[OvertimeRL] Error analyzing live match ${data.guid}:`, err);
  }
});

sseClient.start();

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  // 1. Health & Status
  if (pathname === '/api/status') {
    sendJson(res, 200, {
      status: 'ok',
      grindlog_available: reader.isAvailable(),
      version: '1.0.0',
    });
    return;
  }

  // 2. Real-time SSE to web browsers
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    webClients.add(res);

    req.on('close', () => {
      webClients.delete(res);
    });
    return;
  }

  function getAllFriendMatcher(): { friendIds: Set<string>; friendNames: Set<string> } {
    const friendIds = new Set<string>();
    const friendNames = new Set<string>();
    friendIds.add('Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0');
    friendNames.add('mechless madness');
    friendIds.add('Epic|7d1894456e94432a929fb2982478eb1d|0');
    friendNames.add('rocinante_.');
    try {
      for (const f of reader.getGrindlogFriends()) {
        friendIds.add(f.primary_id);
        if (f.nickname) friendNames.add(f.nickname.trim().toLowerCase());
      }
    } catch {}
    try {
      for (const cf of cache.getCustomFriends()) {
        friendIds.add(cf.primary_id);
        if (cf.name) friendNames.add(cf.name.trim().toLowerCase());
      }
    } catch {}
    return { friendIds, friendNames };
  }

  function getAllFriendIds(): string[] {
    return Array.from(getAllFriendMatcher().friendIds);
  }

  // 3. Recent Matches List
  if (pathname === '/api/matches') {
    try {
      const limit = Number(url.searchParams.get('limit')) || 25;
      const friendsOnly = url.searchParams.get('friends_only') === 'true';
      const matches = friendsOnly
        ? reader.getRecentMatchesWithFriends(getAllFriendIds(), limit)
        : reader.getRecentMatches(limit);
      sendJson(res, 200, matches);
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 4. Match Analysis: /api/match/:guid
  if (pathname.startsWith('/api/match/')) {
    const guid = pathname.replace('/api/match/', '').trim();
    if (!guid) {
      sendJson(res, 400, { error: 'Match GUID required' });
      return;
    }

    try {
      const force = url.searchParams.get('force') === 'true';
      const analysis = analyzer.analyzeMatch(guid, force);
      if (!analysis) {
        sendJson(res, 404, { error: `Match ${guid} not found` });
        return;
      }
      sendJson(res, 200, analysis);
    } catch (e: any) {
      console.error(`Error analyzing match ${guid}:`, e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 5. Session Recap & Leaderboard: /api/session/latest
  if (pathname === '/api/session/latest' || pathname.startsWith('/api/session/')) {
    try {
      const friendsOnly = url.searchParams.get('friends_only') === 'true';
      const matcher = getAllFriendMatcher();
      const recentMatches = friendsOnly
        ? reader.getRecentMatchesWithFriends(Array.from(matcher.friendIds), 15)
        : reader.getRecentMatches(15);
      if (recentMatches.length === 0 && !friendsOnly) {
        sendJson(res, 404, { error: 'No matches found' });
        return;
      }

      let sessionWins = 0;
      let sessionLosses = 0;
      const sessionMatches: SessionMatchSummary[] = [];
      const analyses: MatchAnalysisResult[] = [];

      for (const m of recentMatches) {
        const analysis = analyzer.analyzeMatch(m.guid, false);
        if (!analysis) continue;
        analyses.push(analysis);

        const userPlayer = analysis.players.find(p => p.is_user);
        const userTeamNum = analysis.user_team_num ?? (userPlayer ? userPlayer.team_num : null);
        const isUserWin = userTeamNum !== null
          ? analysis.winner_team_num === userTeamNum
          : (analysis.winner_team_num !== null && analysis.players.some(p => p.team_num === analysis.winner_team_num && !p.is_bot));

        if (isUserWin) sessionWins++;
        else sessionLosses++;

        const mainPlayer = userPlayer || analysis.players.find(p => !p.is_bot) || analysis.players[0];

        sessionMatches.push({
          guid: m.guid,
          started_at: m.started_at,
          score_team0: m.score_team0,
          score_team1: m.score_team1,
          winner_team_num: m.winner_team_num,
          user_team_num: userTeamNum,
          is_win: isUserWin,
          user_rating: mainPlayer ? mainPlayer.rating : 6.0,
          playlist_id: m.playlist_id,
        });
      }

      const podium = buildSessionPodium(analyses, matcher);
      const { totalGoalsFor, totalGoalsAgainst, totalDoubleCommits } = computeSessionTeamTotals(analyses);

      const recap: SessionRecap = {
        session_key: 'latest-session',
        total_matches: sessionMatches.length,
        wins: sessionWins,
        losses: sessionLosses,
        win_rate: sessionMatches.length > 0 ? Math.round((sessionWins / sessionMatches.length) * 100) : 0,
        total_goals_for: totalGoalsFor,
        total_goals_against: totalGoalsAgainst,
        total_double_commits: totalDoubleCommits,
        podium,
        matches: sessionMatches,
      };

      sendJson(res, 200, recap);
    } catch (e: any) {
      console.error('Error generating session recap:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 6. Player Profile: /api/player/profile or /api/player/:primaryId/profile
  if (pathname === '/api/player/profile' || pathname.startsWith('/api/player/')) {
    try {
      let targetId: string | undefined = undefined;
      if (pathname !== '/api/player/profile') {
        const cleaned = pathname.replace('/api/player/', '').replace('/profile', '');
        targetId = decodeURIComponent(cleaned).trim();
      }
      const profile = buildPlayerProfile(reader, targetId, cache, analyzer);
      if (!profile) {
        sendJson(res, 404, { error: 'Player profile not found' });
        return;
      }
      sendJson(res, 200, profile);
    } catch (e: any) {
      console.error('Error generating player profile:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 7. Friends Management: GET /api/friends & POST /api/friends/toggle
  if (pathname === '/api/friends' && req.method === 'GET') {
    try {
      const gFriends = reader.getGrindlogFriends();
      const cFriends = cache.getCustomFriends();
      const map = new Map<string, { primary_id: string; name: string; source: string }>();
      map.set('Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0', { primary_id: 'Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0', name: 'Mechless Madness', source: 'grindlog' });
      map.set('Epic|7d1894456e94432a929fb2982478eb1d|0', { primary_id: 'Epic|7d1894456e94432a929fb2982478eb1d|0', name: 'Rocinante_.', source: 'grindlog' });
      for (const f of gFriends) {
        if (!map.has(f.primary_id)) map.set(f.primary_id, { primary_id: f.primary_id, name: f.nickname || f.primary_id, source: 'grindlog' });
      }
      for (const cf of cFriends) {
        map.set(cf.primary_id, { primary_id: cf.primary_id, name: cf.name, source: 'custom' });
      }
      sendJson(res, 200, Array.from(map.values()));
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (pathname === '/api/friends/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { primary_id, name } = JSON.parse(body || '{}');
        if (!primary_id && !name) {
          sendJson(res, 400, { error: 'primary_id or name is required' });
          return;
        }
        let resolvedPid = primary_id;
        let resolvedName = name || primary_id;
        if (!resolvedPid || resolvedPid.startsWith('custom:')) {
          resolvedPid = `custom:${resolvedName.toLowerCase()}`;
        }
        const isPinned = cache.toggleCustomFriend(resolvedPid, resolvedName);
        sendJson(res, 200, { primary_id: resolvedPid, name: resolvedName, is_pinned: isPinned });
      } catch (e: any) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // 8. Squad Hub (Played With Friends): /api/squad/friends
  if (pathname === '/api/squad/friends') {
    try {
      const friends = buildSquadFriendsStats(reader, cache, analyzer);
      sendJson(res, 200, friends);
    } catch (e: any) {
      console.error('Error generating squad friends stats:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 9. Duo Friend Dossier: /api/squad/friend/:primaryId
  if (pathname.startsWith('/api/squad/friend/')) {
    try {
      const primaryId = decodeURIComponent(pathname.replace('/api/squad/friend/', '').trim());
      const dossier = buildDuoFriendDossier(reader, cache, primaryId, analyzer);
      if (!dossier) {
        sendJson(res, 404, { error: `Friend ${primaryId} dossier not found` });
        return;
      }
      sendJson(res, 200, dossier);
    } catch (e: any) {
      console.error('Error generating duo friend dossier:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 10. 3s Trio Squad Dossier: /api/squad/trio
  if (pathname === '/api/squad/trio') {
    try {
      const dossier = buildTrioSquadDossier(reader, cache, analyzer);
      if (!dossier) {
        sendJson(res, 404, { error: '3s Trio squad dossier not found' });
        return;
      }
      sendJson(res, 200, dossier);
    } catch (e: any) {
      console.error('Error generating 3s trio squad dossier:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 11. Squad Matches Explorer: /api/squad/matches?friends=...&match_all=true/false&mode=2s/3s/all
  if (pathname === '/api/squad/matches' && req.method === 'GET') {
    try {
      const friendsParam = url.searchParams.get('friends');
      const matchAll = url.searchParams.get('match_all') === 'true';
      const modeParam = (url.searchParams.get('mode') || 'all') as 'all' | '2s' | '3s';
      const friends = friendsParam ? friendsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
      const matches = buildSquadExplorerMatches(reader, cache, friends, matchAll, modeParam, analyzer);
      sendJson(res, 200, matches);
    } catch (e: any) {
      console.error('Error generating squad explorer matches:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 12. FIFA+RL Card Preferences & Cycle Card Endpoint
  if (pathname === '/api/card/prefs' && req.method === 'GET') {
    try {
      sendJson(res, 200, cache.getAllCardPrefs());
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (pathname === '/api/card/prefs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsedJson = JSON.parse(body || '{}');
        const validated = PlayerCardPrefsUpdateSchema.safeParse(parsedJson);
        if (!validated.success) {
          sendJson(res, 400, { error: 'Invalid card preferences payload', details: validated.error.flatten() });
          return;
        }
        const saved = cache.upsertCardPrefs(validated.data);
        const refreshed = buildPlayerFifaCard({
          reader,
          primaryId: saved.primary_id,
          cache,
          analyzer,
          cycleSize: DEFAULT_CARD_CYCLE_SIZE,
          prefsOverride: saved,
        });
        sendJson(res, 200, { prefs: saved, card: refreshed });
      } catch (e: any) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON body' });
      }
    });
    return;
  }

  if (pathname.startsWith('/api/card/') && req.method === 'GET') {
    try {
      const targetId = decodeURIComponent(pathname.replace('/api/card/', '').trim());
      const cycleParam = Number(url.searchParams.get('cycle')) || DEFAULT_CARD_CYCLE_SIZE;
      const card = buildPlayerFifaCard({
        reader,
        primaryId: targetId,
        cache,
        analyzer,
        cycleSize: cycleParam,
      });
      if (!card) {
        sendJson(res, 404, { error: `Card not found for ${targetId}` });
        return;
      }
      sendJson(res, 200, card);
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 8. Static Web Assets (Serve dist folder)
  const distDir = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distDir) && req.method === 'GET') {
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    try {
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      const fileData = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileData);
      return;
    } catch {
      // Fall through to 404
    }
  }

  // 404
  sendJson(res, 404, { error: 'Endpoint not found' });
});

function warmMatchCacheAsync(): void {
  if (!reader.isAvailable()) return;
  try {
    const guids = reader.getRecentMatches(300).map(m => m.guid);
    let idx = 0;
    const step = () => {
      if (idx >= guids.length) {
        console.log(`[OvertimeRL] Background engine sync complete (${guids.length} matches cached).`);
        return;
      }
      const guid = guids[idx++];
      try {
        analyzer.analyzeMatch(guid, false);
      } catch {}
      setImmediate(step);
    };
    setTimeout(step, 500);
  } catch {}
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[OvertimeRL] Server listening on http://127.0.0.1:${PORT}`);
  warmMatchCacheAsync();
});
