import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type {
  SquadFriendStats,
  DuoFriendDossier,
  DuoDossierMatch,
  TrioSquadDossier,
  TrioPlayerSummary,
  TrioMatchRecord,
  TrioMatchPlayerStat,
  TrioAssistConnection,
  TrioDoubleCommitPair,
  SquadExplorerMatch,
  MatchPlayerAnalysis,
} from '../../shared/types.ts';
import type { GrindlogReader } from '../ingestion/grindlog-reader.ts';
import type { OvertimeDBCache } from '../db/cache.ts';
import { calculateMatchRatingFromPlayerRow } from './profile.ts';
import { calculatePlayerRadar } from './radar.ts';
import { aggregateRadarFromAnalyses } from './radar-aggregator.ts';
import { MatchAnalyzer } from './analyzer.ts';
import { buildPlayerFifaCard } from './fifa-card.ts';

export function buildSquadFriendsStats(
  reader: GrindlogReader,
  cache?: OvertimeDBCache,
  analyzer?: MatchAnalyzer
): SquadFriendStats[] {
  const primaryUser = reader.getPrimaryUser();
  if (!primaryUser) return [];

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const trackerDbPath = path.join(localAppData, 'Grindlog', 'tracker.db');
  const rawDbPath = path.join(localAppData, 'Grindlog', 'raw.db');

  if (!fs.existsSync(trackerDbPath)) return [];

  const dbTracker = new DatabaseSync(trackerDbPath, { readOnly: true });
  const dbRaw = fs.existsSync(rawDbPath) ? new DatabaseSync(rawDbPath, { readOnly: true }) : null;

  try {
    // Collect pinned friends from Grindlog tracker.db and Overtime custom friends
    const pinnedFriendIds = new Set<string>();
    try {
      const gFriends = dbTracker.prepare('SELECT primary_id FROM friends').all() as Array<{ primary_id: string }>;
      for (const f of gFriends) pinnedFriendIds.add(f.primary_id);
    } catch {}

    if (cache) {
      for (const cf of cache.getCustomFriends()) {
        pinnedFriendIds.add(cf.primary_id);
      }
    }

    const query = `
      SELECT mp.name, mp.primary_id,
             count(*) as matches_together,
             sum(case when m.winner_team_num = mp.team_num then 1 else 0 end) as wins,
             sum(mp.goals) as teammate_goals,
             sum(mp.assists) as teammate_assists,
             sum(user_mp.goals) as user_goals,
             sum(user_mp.assists) as user_assists,
             max(m.started_at) as last_played
      FROM match_players mp
      JOIN matches m ON mp.match_guid = m.guid
      JOIN match_players user_mp ON user_mp.match_guid = m.guid AND user_mp.primary_id = ?
      WHERE mp.primary_id != ? AND mp.team_num = user_mp.team_num AND mp.is_bot = 0
      GROUP BY mp.primary_id
      HAVING count(*) >= 2
      ORDER BY count(*) DESC
    `;

    const teammateRows = dbTracker.prepare(query).all(primaryUser.primary_id, primaryUser.primary_id) as Array<{
      name: string;
      primary_id: string;
      matches_together: number;
      wins: number;
      teammate_goals: number;
      teammate_assists: number;
      user_goals: number;
      user_assists: number;
      last_played: number;
    }>;

    const friendsStats: SquadFriendStats[] = [];

    // Pre-prepare statements for double commit lookup if raw db is available
    const matchStmt = dbTracker.prepare(`
      SELECT mp.match_guid
      FROM match_players mp
      JOIN match_players user_mp ON user_mp.match_guid = mp.match_guid AND user_mp.primary_id = ?
      WHERE mp.primary_id = ? AND mp.team_num = user_mp.team_num
    `);

    const rawHitsStmt = dbRaw
      ? dbRaw.prepare(`
          SELECT ts, data
          FROM events
          WHERE match_guid = ? AND name = 'BallHit'
          ORDER BY ts ASC
        `)
      : null;

    const resolvedAnalyzer = analyzer || new MatchAnalyzer(reader, cache);

    for (const t of teammateRows) {
      let doubleCommits = 0;
      let fatalDoubleCommits = 0;

      const mutualMatches = matchStmt.all(primaryUser.primary_id, t.primary_id) as Array<{ match_guid: string }>;

      for (const m of mutualMatches) {
        try {
          const mAnalysis = resolvedAnalyzer.analyzeMatch(m.match_guid, false);
          if (mAnalysis && mAnalysis.double_commits) {
            for (const dc of mAnalysis.double_commits) {
              const involvesBoth =
                (dc.player1_name === primaryUser.name && dc.player2_name === t.name) ||
                (dc.player1_name === t.name && dc.player2_name === primaryUser.name);
              if (involvesBoth) {
                doubleCommits++;
                if (dc.is_fatal) fatalDoubleCommits++;
              }
            }
          }
        } catch {
          // Non-critical fallback
        }
      }

      const matchesTogether = t.matches_together;
      const wins = t.wins;
      const losses = matchesTogether - wins;
      const winRate = Math.round((wins / matchesTogether) * 1000) / 10;
      const dcPerGame = Math.round((doubleCommits / matchesTogether) * 100) / 100;
      const fatalDcPerGame = Math.round((fatalDoubleCommits / matchesTogether) * 100) / 100;
      const isPinned = pinnedFriendIds.has(t.primary_id);

      // Chemistry Score calculation factoring win rate, assist synergy, and causal tailing penalties
      let chem = 50 + (winRate - 50) * 0.8;
      chem += Math.min(18, (t.teammate_assists + t.user_assists) * 0.6);
      chem -= Math.min(28, dcPerGame * 18 + fatalDcPerGame * 16);
      const chemistryScore = Math.max(15, Math.min(99, Math.round(chem)));

      let chemistryVerdict = 'Solid Partnership: Balanced play across offensive and defensive phases.';
      if (chemistryScore >= 75) {
        chemistryVerdict = 'Elite Duo Synergy: High win rate with synchronized rotational spacing.';
      } else if (dcPerGame >= 0.70) {
        chemistryVerdict = 'Double-Commit Prone: High spatial overlap; communicate before challenging.';
      } else if (winRate >= 52.0) {
        chemistryVerdict = 'Winning Dynamic: Positive match record with reliable offensive conversions.';
      } else if (winRate < 45.0) {
        chemistryVerdict = 'Needs Spacing: Sub-45% win rate; defensive double-commits leave open nets.';
      }

      const buildFriendCard = isPinned || friendsStats.length < 8;
      const fifaCard = buildFriendCard
        ? buildPlayerFifaCard({
            reader,
            primaryId: t.primary_id,
            playerName: t.name,
            cache,
            analyzer: resolvedAnalyzer,
            mode: 'all',
          })
        : null;
      const fifaCard2s = buildFriendCard
        ? buildPlayerFifaCard({
            reader,
            primaryId: t.primary_id,
            playerName: t.name,
            cache,
            analyzer: resolvedAnalyzer,
            mode: '2s',
          })
        : null;
      const fifaCard3s = buildFriendCard
        ? buildPlayerFifaCard({
            reader,
            primaryId: t.primary_id,
            playerName: t.name,
            cache,
            analyzer: resolvedAnalyzer,
            mode: '3s',
          })
        : null;

      friendsStats.push({
        name: t.name,
        primary_id: t.primary_id,
        is_pinned_friend: isPinned,
        matches_together: matchesTogether,
        wins,
        losses,
        win_rate: winRate,
        teammate_goals: t.teammate_goals,
        teammate_assists: t.teammate_assists,
        user_goals: t.user_goals,
        user_assists: t.user_assists,
        double_commits: doubleCommits,
        double_commits_per_game: dcPerGame,
        chemistry_score: chemistryScore,
        chemistry_verdict: chemistryVerdict,
        last_played: t.last_played,
        fifa_card: fifaCard ?? undefined,
        fifa_card_2s: fifaCard2s ?? undefined,
        fifa_card_3s: fifaCard3s ?? undefined,
      });
    }

    return friendsStats.sort((a, b) => {
      if (a.is_pinned_friend && !b.is_pinned_friend) return -1;
      if (!a.is_pinned_friend && b.is_pinned_friend) return 1;
      return b.matches_together - a.matches_together;
    });
  } finally {
    dbTracker.close();
    if (dbRaw) dbRaw.close();
  }
}

export function buildDuoFriendDossier(
  reader: GrindlogReader,
  cache: OvertimeDBCache | undefined,
  friendPrimaryId: string,
  analyzer?: MatchAnalyzer
): DuoFriendDossier | null {
  const primaryUser = reader.getPrimaryUser();
  if (!primaryUser) return null;

  const resolvedAnalyzer = analyzer || new MatchAnalyzer(reader, cache);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const trackerDbPath = path.join(localAppData, 'Grindlog', 'tracker.db');
  const rawDbPath = path.join(localAppData, 'Grindlog', 'raw.db');

  if (!fs.existsSync(trackerDbPath)) return null;

  const dbTracker = new DatabaseSync(trackerDbPath, { readOnly: true });
  const dbRaw = fs.existsSync(rawDbPath) ? new DatabaseSync(rawDbPath, { readOnly: true }) : null;

  try {
    // Check pinned status
    let isPinned = false;
    try {
      const gFriend = dbTracker.prepare('SELECT 1 FROM friends WHERE primary_id = ?').get(friendPrimaryId);
      if (gFriend) isPinned = true;
    } catch {}
    if (!isPinned && cache && cache.isCustomFriend(friendPrimaryId)) {
      isPinned = true;
    }

    // Query all mutual matches
    const qMatches = `
      SELECT m.guid, m.started_at, m.score_team0, m.score_team1, m.winner_team_num, m.arena,
             p_user.team_num as user_team, p_user.goals as user_goals, p_user.assists as user_assists,
             p_user.score as user_score, p_user.saves as user_saves, p_user.shots as user_shots,
             p_user.demos as user_demos, p_user.touches as user_touches, p_user.touches_defence as user_def,
             p_user.touches_midfield as user_mid, p_user.touches_attack as user_att,
             p_user.car_ms as user_car_ms, p_user.supersonic_ms as user_super_ms,
             p_user.boost_avg as user_boost, p_user.empty_boost_ms as user_empty_ms,
             p_user.aerial_touches as user_aerials,
             p_friend.team_num as friend_team, p_friend.goals as friend_goals, p_friend.assists as friend_assists,
             p_friend.score as friend_score, p_friend.saves as friend_saves, p_friend.shots as friend_shots,
             p_friend.demos as friend_demos, p_friend.touches as friend_touches, p_friend.touches_defence as friend_def,
             p_friend.touches_midfield as friend_mid, p_friend.touches_attack as friend_att,
             p_friend.car_ms as friend_car_ms, p_friend.supersonic_ms as friend_super_ms,
             p_friend.boost_avg as friend_boost, p_friend.empty_boost_ms as friend_empty_ms,
             p_friend.aerial_touches as friend_aerials,
             p_friend.name as friend_name,
             p_user.player_key as user_key, p_friend.player_key as friend_key
      FROM matches m
      JOIN match_players p_user ON m.guid = p_user.match_guid AND p_user.primary_id = ?
      JOIN match_players p_friend ON m.guid = p_friend.match_guid AND p_friend.primary_id = ?
      WHERE p_user.team_num = p_friend.team_num
      ORDER BY m.started_at DESC
    `;

    const matchRows = dbTracker.prepare(qMatches).all(primaryUser.primary_id, friendPrimaryId) as Array<any>;
    if (matchRows.length === 0) return null;

    const friendName = matchRows[0].friend_name;

    // Direct assist connections from match_goals
    let friendAssistsToUser = 0;
    let userAssistsToFriend = 0;
    try {
      const qGoals = `
        SELECT
          SUM(CASE WHEN g.scorer_key = p_user.player_key AND g.assister_key = p_friend.player_key THEN 1 ELSE 0 END) as friend_to_user,
          SUM(CASE WHEN g.scorer_key = p_friend.player_key AND g.assister_key = p_user.player_key THEN 1 ELSE 0 END) as user_to_friend
        FROM match_goals g
        JOIN match_players p_user ON g.match_guid = p_user.match_guid AND p_user.primary_id = ?
        JOIN match_players p_friend ON g.match_guid = p_friend.match_guid AND p_friend.primary_id = ?
        WHERE p_user.team_num = p_friend.team_num
      `;
      const goalRow = dbTracker.prepare(qGoals).get(primaryUser.primary_id, friendPrimaryId) as any;
      if (goalRow) {
        friendAssistsToUser = goalRow.friend_to_user || 0;
        userAssistsToFriend = goalRow.user_to_friend || 0;
      }
    } catch {}

    const rawHitsStmt = dbRaw
      ? dbRaw.prepare(`
          SELECT ts, data
          FROM events
          WHERE match_guid = ? AND name = 'BallHit'
          ORDER BY ts ASC
        `)
      : null;

    let totalUserGoals = 0;
    let totalFriendGoals = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalGoalsScored = 0;
    let totalGoalsConceded = 0;
    let totalDoubleCommits = 0;
    let fatalDoubleCommits = 0;
    let userEncroachments = 0;
    let friendEncroachments = 0;
    let matches2s = 0;
    let wins2s = 0;
    let matches3s = 0;
    let wins3s = 0;

    const teamSizeStmt = dbTracker.prepare(`
      SELECT COUNT(*) as team_size
      FROM match_players
      WHERE match_guid = ? AND team_num = ?
    `);

    // Aggregates for user and friend radars
    const uAggr = { goals: 0, shots: 0, assists: 0, saves: 0, demos: 0, def: 0, mid: 0, att: 0, total: 0, carMs: 0, superMs: 0, boostSum: 0, emptyMs: 0, aerials: 0 };
    const fAggr = { goals: 0, shots: 0, assists: 0, saves: 0, demos: 0, def: 0, mid: 0, att: 0, total: 0, carMs: 0, superMs: 0, boostSum: 0, emptyMs: 0, aerials: 0 };

    const userEntries: MatchPlayerAnalysis[] = [];
    const friendEntries: MatchPlayerAnalysis[] = [];
    const dossierMatches: DuoDossierMatch[] = [];

    for (const r of matchRows) {
      const isTeam0 = r.user_team === 0;
      const scoreUser = isTeam0 ? r.score_team0 : r.score_team1;
      const scoreOpp = isTeam0 ? r.score_team1 : r.score_team0;
      const isWin = scoreUser > scoreOpp;

      if (isWin) totalWins++;
      else totalLosses++;

      totalUserGoals += r.user_goals || 0;
      totalFriendGoals += r.friend_goals || 0;
      totalGoalsScored += scoreUser;
      totalGoalsConceded += scoreOpp;

      // Accumulate box fallback telemetry
      uAggr.goals += r.user_goals || 0;
      uAggr.shots += r.user_shots || 0;
      uAggr.assists += r.user_assists || 0;
      uAggr.saves += r.user_saves || 0;
      uAggr.demos += r.user_demos || 0;
      uAggr.def += r.user_def || 0;
      uAggr.mid += r.user_mid || 0;
      uAggr.att += r.user_att || 0;
      uAggr.total += r.user_touches || 0;
      uAggr.carMs += r.user_car_ms || 300000;
      uAggr.superMs += r.user_super_ms || 0;
      uAggr.boostSum += (r.user_boost || 50) * (r.user_car_ms || 300000);
      uAggr.emptyMs += r.user_empty_ms || 0;
      uAggr.aerials += r.user_aerials || 0;

      fAggr.goals += r.friend_goals || 0;
      fAggr.shots += r.friend_shots || 0;
      fAggr.assists += r.friend_assists || 0;
      fAggr.saves += r.friend_saves || 0;
      fAggr.demos += r.friend_demos || 0;
      fAggr.def += r.friend_def || 0;
      fAggr.mid += r.friend_mid || 0;
      fAggr.att += r.friend_att || 0;
      fAggr.total += r.friend_touches || 0;
      fAggr.carMs += r.friend_car_ms || 300000;
      fAggr.superMs += r.friend_super_ms || 0;
      fAggr.boostSum += (r.friend_boost || 50) * (r.friend_car_ms || 300000);
      fAggr.emptyMs += r.friend_empty_ms || 0;
      fAggr.aerials += r.friend_aerials || 0;

      // Run full rules-engine MatchAnalyzer per mutual match
      const mAnalysis = resolvedAnalyzer.analyzeMatch(r.guid, false);
      const uAnalyzed = mAnalysis?.players.find(
        p => p.primary_id === primaryUser.primary_id || p.name === primaryUser.name
      );
      const fAnalyzed = mAnalysis?.players.find(
        p => p.primary_id === friendPrimaryId || p.name === friendName
      );

      if (uAnalyzed) userEntries.push(uAnalyzed);
      if (fAnalyzed) friendEntries.push(fAnalyzed);

      const uRating = uAnalyzed
        ? uAnalyzed.rating
        : calculateMatchRatingFromPlayerRow({
            goals: r.user_goals || 0,
            assists: r.user_assists || 0,
            saves: r.user_saves || 0,
            shots: r.user_shots || 0,
            demos: r.user_demos || 0,
            aerial_touches: r.user_aerials,
            team_num: r.user_team,
            winner_team_num: r.winner_team_num,
            score_team0: r.score_team0,
            score_team1: r.score_team1,
          });

      const fRating = fAnalyzed
        ? fAnalyzed.rating
        : calculateMatchRatingFromPlayerRow({
            goals: r.friend_goals || 0,
            assists: r.friend_assists || 0,
            saves: r.friend_saves || 0,
            shots: r.friend_shots || 0,
            demos: r.friend_demos || 0,
            aerial_touches: r.friend_aerials,
            team_num: r.friend_team,
            winner_team_num: r.winner_team_num,
            score_team0: r.score_team0,
            score_team1: r.score_team1,
          });

      // Extract exact double commits & errors leading to goal from MatchAnalyzer
      let matchDc = 0;
      let matchElg =
        (uAnalyzed?.errors_leading_to_goal || 0) + (fAnalyzed?.errors_leading_to_goal || 0);

      if (mAnalysis && mAnalysis.double_commits) {
        for (const dc of mAnalysis.double_commits) {
          const involvesBoth =
            (dc.player1_name === primaryUser.name && dc.player2_name === friendName) ||
            (dc.player1_name === friendName && dc.player2_name === primaryUser.name);
          if (involvesBoth) {
            matchDc++;
            totalDoubleCommits++;
            if (dc.is_fatal) {
              fatalDoubleCommits++;
            }
            const intruder = dc.instigator_name || dc.player2_name;
            if (intruder === primaryUser.name) {
              userEncroachments++;
            } else if (intruder === friendName) {
              friendEncroachments++;
            }
          }
        }
      }

      // Determine match mode & team size
      let teamSize = 3;
      try {
        const tsRow = teamSizeStmt.get(r.guid, r.user_team) as { team_size: number } | undefined;
        if (tsRow && tsRow.team_size > 0) teamSize = tsRow.team_size;
      } catch {}

      const is2s = teamSize === 2 || r.playlist_id === 2 || r.playlist_id === 11;
      const is3s = teamSize === 3 || r.playlist_id === 13 || r.playlist_id === 3;
      const mode = is2s ? '2v2 Doubles' : is3s ? '3v3 Standard' : 'Other';

      if (is2s) {
        matches2s++;
        if (isWin) wins2s++;
      } else if (is3s) {
        matches3s++;
        if (isWin) wins3s++;
      }

      dossierMatches.push({
        guid: r.guid,
        started_at: r.started_at,
        arena: r.arena,
        score_user: scoreUser,
        score_opp: scoreOpp,
        is_win: isWin,
        user_goals: r.user_goals || 0,
        friend_goals: r.friend_goals || 0,
        user_rating: uRating,
        friend_rating: fRating,
        double_commits: matchDc,
        errors_leading_to_goal: matchElg,
        mode,
        team_size: teamSize,
        playlist_id: r.playlist_id,
      });
    }

    const n = matchRows.length;
    const winRate = Math.round((totalWins / n) * 1000) / 10;
    const dcPerGame = Math.round((totalDoubleCommits / n) * 100) / 100;
    const goalDiff = totalGoalsScored - totalGoalsConceded;

    // Rotational risk
    const rotationalRisk: 'Low' | 'Moderate' | 'High' | 'Critical' =
      dcPerGame < 0.35 ? 'Low' : dcPerGame < 0.60 ? 'Moderate' : dcPerGame < 0.85 ? 'High' : 'Critical';

    // Chemistry Score incorporating fatal overcommits
    let chem = 50 + (winRate - 50) * 0.85;
    chem += Math.min(20, (friendAssistsToUser + userAssistsToFriend) * 1.2);
    chem -= Math.min(28, dcPerGame * 18 + (fatalDoubleCommits / Math.max(1, n)) * 16);
    const chemistryScore = Math.max(15, Math.min(99, Math.round(chem)));

    let chemistryVerdict = 'Solid Partnership: Balanced play across offensive and defensive phases.';
    if (chemistryScore >= 75) {
      chemistryVerdict = 'Elite Duo Synergy: High win rate with synchronized rotational spacing.';
    } else if (dcPerGame >= 0.70) {
      chemistryVerdict = 'Double-Commit Prone: High spatial overlap; communicate before challenging.';
    } else if (winRate >= 52.0) {
      chemistryVerdict = 'Winning Dynamic: Positive match record with reliable offensive conversions.';
    } else if (winRate < 45.0) {
      chemistryVerdict = 'Needs Spacing: Sub-45% win rate; defensive double-commits leave open nets.';
    }

    const passingConnectionRate = Math.round(
      Math.min(100, ((friendAssistsToUser + userAssistsToFriend) / Math.max(1, totalGoalsScored)) * 100)
    );
    const thirdManCoveragePct = Math.round(
      Math.max(40, Math.min(95, 85 - dcPerGame * 26 + (totalWins / Math.max(1, n)) * 12))
    );

    const encroachmentDiff = userEncroachments - friendEncroachments;
    const encroachmentSummary =
      encroachmentDiff > 1
        ? `You tend to tail ${friendName} into contested zones (${userEncroachments} vs ${friendEncroachments}). Give carrier space to flick or pass.`
        : encroachmentDiff < -1
        ? `${friendName} tends to tail your carries (${friendEncroachments} vs ${userEncroachments}). Call your dribbles early.`
        : `Balanced spacing discipline: ${userEncroachments} vs ${friendEncroachments} encroachments.`;

    // Synergy Insights
    const synergyInsights: string[] = [
      `Overall Duo Record: ${totalWins}W - ${totalLosses}L (${winRate}% win rate) across ${n} games with a ${goalDiff >= 0 ? `+${goalDiff}` : goalDiff} goal differential.`,
      `Passing Connection: ${friendAssistsToUser} assists from ${friendName} to you, and ${userAssistsToFriend} assists from you to ${friendName} (${passingConnectionRate}% of team goals assisted).`,
      `Mutual Tailing & Collision Index: ${totalDoubleCommits} total mutual double commits (${fatalDoubleCommits} fatal). ${encroachmentSummary}`,
      `Rotational Safety Factor: ${thirdManCoveragePct}% last-man coverage efficiency during offensive transitions. Rotational Risk: ${rotationalRisk}.`,
    ];

    // Compute Rule-Aware Radars directly from analyzed mutual match telemetry
    const userRadar =
      userEntries.length > 0
        ? aggregateRadarFromAnalyses(userEntries)
        : calculatePlayerRadar({
            goals: uAggr.goals,
            shots: uAggr.shots,
            assists: uAggr.assists,
            saves: uAggr.saves,
            demos: uAggr.demos,
            clearances: Math.round(uAggr.def * 0.4),
            keyPasses: uAggr.assists,
            duelsWon: Math.round(uAggr.demos * 0.8),
            touchesMidfield: uAggr.mid,
            touchesTotal: Math.max(1, uAggr.total),
            carMs: Math.max(1, uAggr.carMs),
            supersonicMs: uAggr.superMs,
            boostAvg: uAggr.carMs > 0 ? uAggr.boostSum / uAggr.carMs : 50,
            emptyBoostMs: uAggr.emptyMs,
            xg: uAggr.goals * 0.85,
            aerialTouches: uAggr.aerials,
            doubleCommits: userEncroachments,
          });

    const friendRadar =
      friendEntries.length > 0
        ? aggregateRadarFromAnalyses(friendEntries)
        : calculatePlayerRadar({
            goals: fAggr.goals,
            shots: fAggr.shots,
            assists: fAggr.assists,
            saves: fAggr.saves,
            demos: fAggr.demos,
            clearances: Math.round(fAggr.def * 0.4),
            keyPasses: fAggr.assists,
            duelsWon: Math.round(fAggr.demos * 0.8),
            touchesMidfield: fAggr.mid,
            touchesTotal: Math.max(1, fAggr.total),
            carMs: Math.max(1, fAggr.carMs),
            supersonicMs: fAggr.superMs,
            boostAvg: fAggr.carMs > 0 ? fAggr.boostSum / fAggr.carMs : 50,
            emptyBoostMs: fAggr.emptyMs,
            xg: fAggr.goals * 0.85,
            aerialTouches: fAggr.aerials,
            doubleCommits: friendEncroachments,
          });

    return {
      name: friendName,
      primary_id: friendPrimaryId,
      is_pinned_friend: isPinned,
      matches_together: n,
      wins: totalWins,
      losses: totalLosses,
      win_rate: winRate,
      matches_2s: matches2s,
      wins_2s: wins2s,
      matches_3s: matches3s,
      wins_3s: wins3s,
      user_goals: totalUserGoals,
      friend_goals: totalFriendGoals,
      user_assists_to_friend: userAssistsToFriend,
      friend_assists_to_user: friendAssistsToUser,
      goal_differential: goalDiff,
      double_commits: totalDoubleCommits,
      fatal_double_commits: fatalDoubleCommits,
      double_commits_per_game: dcPerGame,
      user_encroachments: userEncroachments,
      friend_encroachments: friendEncroachments,
      passing_connection_rate: passingConnectionRate,
      third_man_coverage_pct: thirdManCoveragePct,
      rotational_risk: rotationalRisk,
      chemistry_score: chemistryScore,
      chemistry_verdict: chemistryVerdict,
      synergy_insights: synergyInsights,
      user_radar: userRadar,
      friend_radar: friendRadar,
      matches: dossierMatches,
    };
  } finally {
    dbTracker.close();
    if (dbRaw) dbRaw.close();
  }
}

/**
 * Builds the comprehensive 3s Trio Dossier for Swapo_o + Rocinante_. + Mechless Madness
 * Computing overall contributions, who did better per-game, passing connections, and double commit dynamics.
 */
export function buildTrioSquadDossier(
  reader: GrindlogReader,
  cache?: OvertimeDBCache,
  analyzer?: MatchAnalyzer
): TrioSquadDossier | null {
  const primaryUser = reader.getPrimaryUser();
  if (!primaryUser) return null;

  const resolvedAnalyzer = analyzer || new MatchAnalyzer(reader, cache);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const trackerDbPath = path.join(localAppData, 'Grindlog', 'tracker.db');
  const rawDbPath = path.join(localAppData, 'Grindlog', 'raw.db');

  if (!fs.existsSync(trackerDbPath)) return null;

  const dbTracker = new DatabaseSync(trackerDbPath, { readOnly: true });
  const dbRaw = fs.existsSync(rawDbPath) ? new DatabaseSync(rawDbPath, { readOnly: true }) : null;

  try {
    const qMatches = `
      SELECT 
        m.guid,
        m.started_at,
        m.playlist_id,
        m.arena,
        m.score_team0,
        m.score_team1,
        m.winner_team_num,
        p1.team_num as user_team,
        p1.goals as u_goals, p1.assists as u_assists, p1.saves as u_saves, p1.shots as u_shots, p1.demos as u_demos, p1.score as u_score,
        p1.car_ms as u_car_ms, p1.supersonic_ms as u_super_ms, p1.empty_boost_ms as u_empty_ms, p1.aerial_touches as u_aerials,
        p1.touches_defence as u_def, p1.touches_midfield as u_mid, p1.touches_attack as u_att, p1.touches as u_touches, p1.boost_avg as u_boost,
        p1.primary_id as u_pid, p1.name as u_name,
        p2.goals as r_goals, p2.assists as r_assists, p2.saves as r_saves, p2.shots as r_shots, p2.demos as r_demos, p2.score as r_score,
        p2.car_ms as r_car_ms, p2.supersonic_ms as r_super_ms, p2.empty_boost_ms as r_empty_ms, p2.aerial_touches as r_aerials,
        p2.touches_defence as r_def, p2.touches_midfield as r_mid, p2.touches_attack as r_att, p2.touches as r_touches, p2.boost_avg as r_boost,
        p2.primary_id as r_pid, p2.name as r_name,
        p3.goals as m_goals, p3.assists as m_assists, p3.saves as m_saves, p3.shots as m_shots, p3.demos as m_demos, p3.score as m_score,
        p3.car_ms as m_car_ms, p3.supersonic_ms as m_super_ms, p3.empty_boost_ms as m_empty_ms, p3.aerial_touches as m_aerials,
        p3.touches_defence as m_def, p3.touches_midfield as m_mid, p3.touches_attack as m_att, p3.touches as m_touches, p3.boost_avg as m_boost,
        p3.primary_id as m_pid, p3.name as m_name
      FROM matches m
      JOIN match_players p1 ON m.guid = p1.match_guid AND (p1.name = 'Swapo_o' OR p1.primary_id LIKE '%f5c0f37f0a5649e4bff607332fcf8ac0%')
      JOIN match_players p2 ON m.guid = p2.match_guid AND (p2.name = 'Rocinante_.' OR p2.primary_id LIKE '%7d1894456e94432a929fb2982478eb1d%')
      JOIN match_players p3 ON m.guid = p3.match_guid AND (p3.name = 'Mechless Madness' OR p3.primary_id LIKE '%6cfc32973fa343fc9f07ec20c3a9e0b1%')
      WHERE p1.team_num = p2.team_num AND p2.team_num = p3.team_num
      ORDER BY m.started_at DESC
    `;

    const matchRows = dbTracker.prepare(qMatches).all() as Array<any>;
    if (matchRows.length === 0) return null;

    const n = matchRows.length;
    let totalWins = 0;
    let totalLosses = 0;
    let totalGoalsScored = 0;
    let totalGoalsConceded = 0;
    let totalDoubleCommits = 0;

    // Cumulative stats
    const p1Stats = { name: 'Swapo_o', pid: matchRows[0].u_pid, isUser: true, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, score: 0, ratingSum: 0, mvpCount: 0, def: 0, mid: 0, att: 0, touches: 0, carMs: 0, superMs: 0, boostSum: 0, emptyMs: 0, aerials: 0 };
    const p2Stats = { name: 'Rocinante_.', pid: matchRows[0].r_pid, isUser: false, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, score: 0, ratingSum: 0, mvpCount: 0, def: 0, mid: 0, att: 0, touches: 0, carMs: 0, superMs: 0, boostSum: 0, emptyMs: 0, aerials: 0 };
    const p3Stats = { name: 'Mechless Madness', pid: matchRows[0].m_pid, isUser: false, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, score: 0, ratingSum: 0, mvpCount: 0, def: 0, mid: 0, att: 0, touches: 0, carMs: 0, superMs: 0, boostSum: 0, emptyMs: 0, aerials: 0 };

    const doubleCommitPairs: Record<string, { count: number; p1_name: string; p2_name: string; p1_encroached: number; p2_encroached: number }> = {
      'Swapo_o & Mechless Madness': { count: 0, p1_name: 'Swapo_o', p2_name: 'Mechless Madness', p1_encroached: 0, p2_encroached: 0 },
      'Rocinante_. & Mechless Madness': { count: 0, p1_name: 'Rocinante_.', p2_name: 'Mechless Madness', p1_encroached: 0, p2_encroached: 0 },
      'Swapo_o & Rocinante_.': { count: 0, p1_name: 'Swapo_o', p2_name: 'Rocinante_.', p1_encroached: 0, p2_encroached: 0 },
    };

    const rawHitsStmt = dbRaw
      ? dbRaw.prepare("SELECT ts, data FROM events WHERE match_guid = ? AND name = 'BallHit' ORDER BY seq ASC")
      : null;

    const uEntries: MatchPlayerAnalysis[] = [];
    const rEntries: MatchPlayerAnalysis[] = [];
    const mEntries: MatchPlayerAnalysis[] = [];
    const matchRecords: TrioMatchRecord[] = [];

    for (const r of matchRows) {
      const isTeam0 = r.user_team === 0;
      const scoreTeam = isTeam0 ? r.score_team0 : r.score_team1;
      const scoreOpp = isTeam0 ? r.score_team1 : r.score_team0;
      const isWin = scoreTeam > scoreOpp;

      if (isWin) totalWins++;
      else totalLosses++;

      totalGoalsScored += scoreTeam;
      totalGoalsConceded += scoreOpp;

      // Use authoritative full-rules MatchAnalyzer results
      const mAnalysis = resolvedAnalyzer.analyzeMatch(r.guid, false);
      const uAnalyzed = mAnalysis?.players.find(
        p => p.primary_id === r.u_pid || p.name === r.u_name || p.name === 'Swapo_o'
      );
      const rAnalyzed = mAnalysis?.players.find(
        p => p.primary_id === r.r_pid || p.name === r.r_name || p.name === 'Rocinante_.'
      );
      const mAnalyzed = mAnalysis?.players.find(
        p => p.primary_id === r.m_pid || p.name === r.m_name || p.name === 'Mechless Madness'
      );

      if (uAnalyzed) uEntries.push(uAnalyzed);
      if (rAnalyzed) rEntries.push(rAnalyzed);
      if (mAnalyzed) mEntries.push(mAnalyzed);

      const uRating = uAnalyzed
        ? uAnalyzed.rating
        : calculateMatchRatingFromPlayerRow({
            goals: r.u_goals || 0, assists: r.u_assists || 0, saves: r.u_saves || 0, shots: r.u_shots || 0, demos: r.u_demos || 0,
            team_num: r.user_team, winner_team_num: r.winner_team_num, score_team0: r.score_team0, score_team1: r.score_team1,
          });
      const rRating = rAnalyzed
        ? rAnalyzed.rating
        : calculateMatchRatingFromPlayerRow({
            goals: r.r_goals || 0, assists: r.r_assists || 0, saves: r.r_saves || 0, shots: r.r_shots || 0, demos: r.r_demos || 0,
            team_num: r.user_team, winner_team_num: r.winner_team_num, score_team0: r.score_team0, score_team1: r.score_team1,
          });
      const mRating = mAnalyzed
        ? mAnalyzed.rating
        : calculateMatchRatingFromPlayerRow({
            goals: r.m_goals || 0, assists: r.m_assists || 0, saves: r.m_saves || 0, shots: r.m_shots || 0, demos: r.m_demos || 0,
            team_num: r.user_team, winner_team_num: r.winner_team_num, score_team0: r.score_team0, score_team1: r.score_team1,
          });

      // Accumulate
      p1Stats.goals += r.u_goals || 0; p1Stats.assists += r.u_assists || 0; p1Stats.saves += r.u_saves || 0; p1Stats.shots += r.u_shots || 0; p1Stats.demos += r.u_demos || 0; p1Stats.score += r.u_score || 0; p1Stats.ratingSum += uRating;
      p1Stats.def += r.u_def || 0; p1Stats.mid += r.u_mid || 0; p1Stats.att += r.u_att || 0; p1Stats.touches += r.u_touches || 0; p1Stats.carMs += r.u_car_ms || 300000; p1Stats.superMs += r.u_super_ms || 0; p1Stats.boostSum += (r.u_boost || 50) * (r.u_car_ms || 300000); p1Stats.emptyMs += r.u_empty_ms || 0; p1Stats.aerials += r.u_aerials || 0;

      p2Stats.goals += r.r_goals || 0; p2Stats.assists += r.r_assists || 0; p2Stats.saves += r.r_saves || 0; p2Stats.shots += r.r_shots || 0; p2Stats.demos += r.r_demos || 0; p2Stats.score += r.r_score || 0; p2Stats.ratingSum += rRating;
      p2Stats.def += r.r_def || 0; p2Stats.mid += r.r_mid || 0; p2Stats.att += r.r_att || 0; p2Stats.touches += r.r_touches || 0; p2Stats.carMs += r.r_car_ms || 300000; p2Stats.superMs += r.r_super_ms || 0; p2Stats.boostSum += (r.r_boost || 50) * (r.r_car_ms || 300000); p2Stats.emptyMs += r.r_empty_ms || 0; p2Stats.aerials += r.r_aerials || 0;

      p3Stats.goals += r.m_goals || 0; p3Stats.assists += r.m_assists || 0; p3Stats.saves += r.m_saves || 0; p3Stats.shots += r.m_shots || 0; p3Stats.demos += r.m_demos || 0; p3Stats.score += r.m_score || 0; p3Stats.ratingSum += mRating;
      p3Stats.def += r.m_def || 0; p3Stats.mid += r.m_mid || 0; p3Stats.att += r.m_att || 0; p3Stats.touches += r.m_touches || 0; p3Stats.carMs += r.m_car_ms || 300000; p3Stats.superMs += r.m_super_ms || 0; p3Stats.boostSum += (r.m_boost || 50) * (r.m_car_ms || 300000); p3Stats.emptyMs += r.m_empty_ms || 0; p3Stats.aerials += r.m_aerials || 0;

      // Determine Trio Match MVP
      let bestPlayer = 'Swapo_o';
      if (uRating >= rRating && uRating >= mRating) {
        bestPlayer = 'Swapo_o';
        p1Stats.mvpCount++;
      } else if (rRating >= uRating && rRating >= mRating) {
        bestPlayer = 'Rocinante_.';
        p2Stats.mvpCount++;
      } else {
        bestPlayer = 'Mechless Madness';
        p3Stats.mvpCount++;
      }

      // Extract double commits & errors leading to goal from MatchAnalyzer
      let matchDc = 0;
      const matchElg =
        (uAnalyzed?.errors_leading_to_goal || 0) +
        (rAnalyzed?.errors_leading_to_goal || 0) +
        (mAnalyzed?.errors_leading_to_goal || 0);

      if (mAnalysis && mAnalysis.double_commits) {
        for (const dc of mAnalysis.double_commits) {
          if (dc.team_num !== r.user_team) continue;
          matchDc++;
          totalDoubleCommits++;
          const names = [dc.player1_name, dc.player2_name];
          let pairKey = '';
          if (names.includes('Swapo_o') && names.includes('Mechless Madness')) {
            pairKey = 'Swapo_o & Mechless Madness';
          } else if (names.includes('Rocinante_.') && names.includes('Mechless Madness')) {
            pairKey = 'Rocinante_. & Mechless Madness';
          } else if (names.includes('Swapo_o') && names.includes('Rocinante_.')) {
            pairKey = 'Swapo_o & Rocinante_.';
          }
          if (pairKey && doubleCommitPairs[pairKey]) {
            const pInfo = doubleCommitPairs[pairKey];
            pInfo.count++;
            const intruder = dc.instigator_name || dc.player2_name;
            if (intruder === pInfo.p1_name) {
              pInfo.p1_encroached++;
            } else if (intruder === pInfo.p2_name) {
              pInfo.p2_encroached++;
            }
          }
        }
      }

      matchRecords.push({
        guid: r.guid,
        started_at: r.started_at,
        arena: r.arena,
        score_team: scoreTeam,
        score_opp: scoreOpp,
        is_win: isWin,
        best_player: bestPlayer,
        players: [
          { name: 'Swapo_o', rating: uRating, goals: r.u_goals || 0, assists: r.u_assists || 0, saves: r.u_saves || 0, shots: r.u_shots || 0, demos: r.u_demos || 0, score: r.u_score || 0 },
          { name: 'Rocinante_.', rating: rRating, goals: r.r_goals || 0, assists: r.r_assists || 0, saves: r.r_saves || 0, shots: r.r_shots || 0, demos: r.r_demos || 0, score: r.r_score || 0 },
          { name: 'Mechless Madness', rating: mRating, goals: r.m_goals || 0, assists: r.m_assists || 0, saves: r.m_saves || 0, shots: r.m_shots || 0, demos: r.m_demos || 0, score: r.m_score || 0 },
        ],
        double_commits: matchDc,
        errors_leading_to_goal: matchElg,
      });
    }

    // Query Assist Network
    const guidsList = matchRows.map(m => `'${m.guid}'`).join(',');
    const assistNetwork: TrioAssistConnection[] = [];
    try {
      const qAssists = `
        SELECT 
          p_assist.name as passer,
          p_score.name as scorer,
          COUNT(*) as assists
        FROM match_goals g
        JOIN match_players p_score ON g.match_guid = p_score.match_guid AND g.scorer_key = p_score.player_key
        JOIN match_players p_assist ON g.match_guid = p_assist.match_guid AND g.assister_key = p_assist.player_key
        WHERE g.match_guid IN (${guidsList})
          AND p_score.name IN ('Swapo_o', 'Rocinante_.', 'Mechless Madness')
          AND p_assist.name IN ('Swapo_o', 'Rocinante_.', 'Mechless Madness')
        GROUP BY p_assist.name, p_score.name
        ORDER BY assists DESC
      `;
      const rows = dbTracker.prepare(qAssists).all() as Array<{ passer: string; scorer: string; assists: number }>;
      for (const row of rows) {
        assistNetwork.push({ passer: row.passer, scorer: row.scorer, assists: Number(row.assists) });
      }
    } catch {}

    // Calculate Rule-Aware Radars directly from aggregated MatchAnalyzer results
    const uRadar =
      uEntries.length > 0
        ? aggregateRadarFromAnalyses(uEntries)
        : calculatePlayerRadar({
            goals: p1Stats.goals,
            shots: p1Stats.shots,
            assists: p1Stats.assists,
            saves: p1Stats.saves,
            demos: p1Stats.demos,
            clearances: Math.round(p1Stats.def * 0.4),
            keyPasses: p1Stats.assists,
            duelsWon: Math.round(p1Stats.touches * 0.15),
            touchesMidfield: p1Stats.mid,
            touchesTotal: p1Stats.touches,
            carMs: p1Stats.carMs,
            supersonicMs: p1Stats.superMs,
            boostAvg: p1Stats.carMs > 0 ? p1Stats.boostSum / p1Stats.carMs : 50,
            emptyBoostMs: p1Stats.emptyMs,
            xg: p1Stats.shots * 0.18,
            aerialTouches: p1Stats.aerials,
            doubleCommits: doubleCommitPairs['Swapo_o & Mechless Madness'].p1_encroached + doubleCommitPairs['Swapo_o & Rocinante_.'].p1_encroached,
          });

    const rRadar =
      rEntries.length > 0
        ? aggregateRadarFromAnalyses(rEntries)
        : calculatePlayerRadar({
            goals: p2Stats.goals,
            shots: p2Stats.shots,
            assists: p2Stats.assists,
            saves: p2Stats.saves,
            demos: p2Stats.demos,
            clearances: Math.round(p2Stats.def * 0.55),
            keyPasses: p2Stats.assists,
            duelsWon: Math.round(p2Stats.touches * 0.18),
            touchesMidfield: p2Stats.mid,
            touchesTotal: p2Stats.touches,
            carMs: p2Stats.carMs,
            supersonicMs: p2Stats.superMs,
            boostAvg: p2Stats.carMs > 0 ? p2Stats.boostSum / p2Stats.carMs : 50,
            emptyBoostMs: p2Stats.emptyMs,
            xg: p2Stats.shots * 0.16,
            aerialTouches: p2Stats.aerials,
            doubleCommits: doubleCommitPairs['Rocinante_. & Mechless Madness'].p1_encroached + doubleCommitPairs['Swapo_o & Rocinante_.'].p2_encroached,
          });

    const mRadar =
      mEntries.length > 0
        ? aggregateRadarFromAnalyses(mEntries)
        : calculatePlayerRadar({
            goals: p3Stats.goals,
            shots: p3Stats.shots,
            assists: p3Stats.assists,
            saves: p3Stats.saves,
            demos: p3Stats.demos,
            clearances: Math.round(p3Stats.def * 0.35),
            keyPasses: p3Stats.assists,
            duelsWon: Math.round(p3Stats.touches * 0.15),
            touchesMidfield: p3Stats.mid,
            touchesTotal: p3Stats.touches,
            carMs: p3Stats.carMs,
            supersonicMs: p3Stats.superMs,
            boostAvg: p3Stats.carMs > 0 ? p3Stats.boostSum / p3Stats.carMs : 50,
            emptyBoostMs: p3Stats.emptyMs,
            xg: p3Stats.shots * 0.20,
            aerialTouches: p3Stats.aerials,
            doubleCommits: doubleCommitPairs['Swapo_o & Mechless Madness'].p2_encroached + doubleCommitPairs['Rocinante_. & Mechless Madness'].p2_encroached,
          });

    const playerSummaries: TrioPlayerSummary[] = [
      {
        name: 'Swapo_o',
        primary_id: p1Stats.pid,
        is_user: true,
        avg_rating: Math.round((p1Stats.ratingSum / n) * 100) / 100,
        total_goals: p1Stats.goals,
        goals_per_game: Math.round((p1Stats.goals / n) * 100) / 100,
        total_assists: p1Stats.assists,
        assists_per_game: Math.round((p1Stats.assists / n) * 100) / 100,
        total_saves: p1Stats.saves,
        saves_per_game: Math.round((p1Stats.saves / n) * 100) / 100,
        total_shots: p1Stats.shots,
        shot_conversion_pct: p1Stats.shots > 0 ? Math.round((p1Stats.goals / p1Stats.shots) * 100) : 0,
        total_demos: p1Stats.demos,
        demos_per_game: Math.round((p1Stats.demos / n) * 100) / 100,
        avg_score: Math.round(p1Stats.score / n),
        mvp_count: p1Stats.mvpCount,
        radar: uRadar,
        fifa_card:
          buildPlayerFifaCard({
            reader,
            primaryId: p1Stats.pid,
            playerName: 'Swapo_o',
            cache,
            analyzer: resolvedAnalyzer,
            mode: '3s',
          }) ?? undefined,
      },
      {
        name: 'Mechless Madness',
        primary_id: p3Stats.pid,
        is_user: false,
        avg_rating: Math.round((p3Stats.ratingSum / n) * 100) / 100,
        total_goals: p3Stats.goals,
        goals_per_game: Math.round((p3Stats.goals / n) * 100) / 100,
        total_assists: p3Stats.assists,
        assists_per_game: Math.round((p3Stats.assists / n) * 100) / 100,
        total_saves: p3Stats.saves,
        saves_per_game: Math.round((p3Stats.saves / n) * 100) / 100,
        total_shots: p3Stats.shots,
        shot_conversion_pct: p3Stats.shots > 0 ? Math.round((p3Stats.goals / p3Stats.shots) * 100) : 0,
        total_demos: p3Stats.demos,
        demos_per_game: Math.round((p3Stats.demos / n) * 100) / 100,
        avg_score: Math.round(p3Stats.score / n),
        mvp_count: p3Stats.mvpCount,
        radar: mRadar,
        fifa_card:
          buildPlayerFifaCard({
            reader,
            primaryId: p3Stats.pid,
            playerName: 'Mechless Madness',
            cache,
            analyzer: resolvedAnalyzer,
            mode: '3s',
          }) ?? undefined,
      },
      {
        name: 'Rocinante_.',
        primary_id: p2Stats.pid,
        is_user: false,
        avg_rating: Math.round((p2Stats.ratingSum / n) * 100) / 100,
        total_goals: p2Stats.goals,
        goals_per_game: Math.round((p2Stats.goals / n) * 100) / 100,
        total_assists: p2Stats.assists,
        assists_per_game: Math.round((p2Stats.assists / n) * 100) / 100,
        total_saves: p2Stats.saves,
        saves_per_game: Math.round((p2Stats.saves / n) * 100) / 100,
        total_shots: p2Stats.shots,
        shot_conversion_pct: p2Stats.shots > 0 ? Math.round((p2Stats.goals / p2Stats.shots) * 100) : 0,
        total_demos: p2Stats.demos,
        demos_per_game: Math.round((p2Stats.demos / n) * 100) / 100,
        avg_score: Math.round(p2Stats.score / n),
        mvp_count: p2Stats.mvpCount,
        radar: rRadar,
        fifa_card:
          buildPlayerFifaCard({
            reader,
            primaryId: p2Stats.pid,
            playerName: 'Rocinante_.',
            cache,
            analyzer: resolvedAnalyzer,
            mode: '3s',
          }) ?? undefined,
      },
    ];

    // Intra double-commits sorted with asymmetric encroacher attribution
    const intraDoubleCommits: TrioDoubleCommitPair[] = Object.entries(doubleCommitPairs).map(([pair, info]) => ({
      pair,
      count: info.count,
      p1_name: info.p1_name,
      p2_name: info.p2_name,
      p1_encroached: info.p1_encroached,
      p2_encroached: info.p2_encroached,
    })).sort((a, b) => b.count - a.count);

    // Build structured 3x3 Passing Connection Matrix
    const squadNames = ['Swapo_o', 'Rocinante_.', 'Mechless Madness'];
    const passingMatrix: Array<{
      passer: string;
      receiver: string;
      passes: number;
      goals: number;
      conversion_pct: number;
    }> = [];

    for (const passer of squadNames) {
      for (const receiver of squadNames) {
        if (passer === receiver) continue;
        const conn = assistNetwork.find(a => a.passer === passer && a.scorer === receiver);
        const goalsCount = conn ? conn.assists : 0;
        // Estimated key delivery attempts (at least goals + missed looks)
        const passesEst = Math.max(goalsCount, Math.round(goalsCount * 1.75));
        const convPct = passesEst > 0 ? Math.round((goalsCount / passesEst) * 100) : 0;
        passingMatrix.push({
          passer,
          receiver,
          passes: passesEst,
          goals: goalsCount,
          conversion_pct: convPct,
        });
      }
    }

    const thirdManCoveragePct = Math.round(
      Math.max(45, Math.min(95, 86 - (totalDoubleCommits / Math.max(1, n)) * 22 + (totalWins / Math.max(1, n)) * 14))
    );

    const winRate = Math.round((totalWins / n) * 1000) / 10;
    const dcPerGame = Math.round((totalDoubleCommits / n) * 100) / 100;
    const goalDiff = totalGoalsScored - totalGoalsConceded;

    const topCollisionPair = intraDoubleCommits[0];
    const [swapoSummary, mechlessSummary, rociSummary] = playerSummaries;
    const bySaves = [...playerSummaries].sort((a, b) => b.total_saves - a.total_saves);
    const byAssists = [...playerSummaries].sort((a, b) => b.total_assists - a.total_assists);
    const byRating = [...playerSummaries].sort((a, b) => b.avg_rating - a.avg_rating);
    const byMvp = [...playerSummaries].sort((a, b) => b.mvp_count - a.mvp_count);
    const anchorPlayer = bySaves[0];
    const playmakerPlayer = byAssists[0];
    const starPlayer = byRating[0];
    const mvpLeader = byMvp[0];
    const dualStrikersGoals = (swapoSummary?.total_goals || 0) + (mechlessSummary?.total_goals || 0);
    const dualStrikersPct = totalGoalsScored > 0 ? ((dualStrikersGoals / totalGoalsScored) * 100).toFixed(1) : '0.0';
    const playmakerTargets = playerSummaries
      .filter(p => p.name !== playmakerPlayer.name)
      .map(p => {
        const direct = assistNetwork.find(a => a.passer === playmakerPlayer.name && a.scorer === p.name)?.assists || 0;
        return `${p.name} (${direct} assists)`;
      });

    const tacticalInsights: string[] = [
      topCollisionPair && topCollisionPair.count > 0
        ? `Frontline Collision Hotspot: ${topCollisionPair.pair} generated ${topCollisionPair.count} double-commits (${Math.round((topCollisionPair.count / (totalDoubleCommits || 1)) * 100)}% of squad collisions; ${topCollisionPair.p1_name} encroached ${topCollisionPair.p1_encroached}x vs ${topCollisionPair.p2_name} ${topCollisionPair.p2_encroached}x). Staggering approaches will open more finishing windows.`
        : `Clean Spacing Profile: Minimal double-commit overlap detected across this 3s rotation (${dcPerGame}/game).`,
      `Anchor & Feeder: ${anchorPlayer.name} anchors the squad with ${anchorPlayer.total_saves} total saves (${anchorPlayer.saves_per_game.toFixed(2)}/gm), while ${playmakerPlayer.name} leads creation with ${playmakerPlayer.total_assists} assists (feeding ${playmakerTargets.join(' and ')}).`,
      `Top Finisher & MVP: ${mvpLeader.name} leads Match MVP awards (${mvpLeader.mvp_count} of ${n} games, ${((mvpLeader.mvp_count / n) * 100).toFixed(1)}%), while ${starPlayer.name} paces the trio at ${starPlayer.avg_rating.toFixed(2)} avg rating with ${starPlayer.total_goals} goals.`,
      `Defensive Coverage Efficiency: Squad maintained ${thirdManCoveragePct}% safe third-man defensive coverage during attacking sequences (${totalGoalsConceded} goals conceded in ${n} matches).`,
      `Primary Scoring Tandem: ${swapoSummary.name} and ${mechlessSummary.name} combine for ${dualStrikersGoals} of the squad's ${totalGoalsScored} total goals (${dualStrikersPct}%), with ${rociSummary.name} stabilizing midfield transitions.`,
    ];

    const topCollisionLabel = topCollisionPair ? `${topCollisionPair.p1_name} / ${topCollisionPair.p2_name}` : 'frontline';
    const synergyVerdict =
      winRate >= 50
        ? `Dominant 3s Trio (${winRate}% WR): Strong offensive firepower (${goalDiff >= 0 ? '+' : ''}${goalDiff} GD, ${totalGoalsScored} GF) with ${thirdManCoveragePct}% third-man safety. Clean up ${topCollisionLabel} rotational overlap (${dcPerGame}/game) to push win rate higher.`
        : `High Firepower, Spacing Vulnerability (${winRate}% WR): ${totalGoalsScored}-goal offensive unit (${goalDiff >= 0 ? '+' : ''}${goalDiff} GD), but collision frequency (${dcPerGame}/game) and errors trigger counterattack concessions.`;

    return {
      squad_name: 'Swapo_o + Rocinante_. + Mechless Madness',
      matches_together: n,
      wins: totalWins,
      losses: totalLosses,
      win_rate: winRate,
      goal_differential: goalDiff,
      total_goals_scored: totalGoalsScored,
      total_goals_conceded: totalGoalsConceded,
      total_double_commits: totalDoubleCommits,
      double_commits_per_game: dcPerGame,
      third_man_coverage_pct: thirdManCoveragePct,
      players: playerSummaries,
      passing_network: assistNetwork,
      passing_matrix: passingMatrix,
      intra_double_commits: intraDoubleCommits,
      synergy_verdict: synergyVerdict,
      tactical_insights: tacticalInsights,
      matches: matchRecords,
    };
  } finally {
    dbTracker.close();
    if (dbRaw) dbRaw.close();
  }
}

/**
 * Flexible Squad Matches Explorer:
 * Returns all matches played with ANY combination of squad friends,
 * supporting filtering by specific friends (e.g. ['Rocinante_.', 'hulkpenning'])
 * or matching ANY / ALL selected friends.
 */
export function buildSquadExplorerMatches(
  reader: GrindlogReader,
  cache?: OvertimeDBCache,
  selectedFriends?: string[],
  matchAll: boolean = false,
  modeFilter: 'all' | '2s' | '3s' = 'all',
  analyzer?: MatchAnalyzer
): SquadExplorerMatch[] {
  const primaryUser = reader.getPrimaryUser();
  if (!primaryUser) return [];

  const resolvedAnalyzer = analyzer || new MatchAnalyzer(reader, cache);

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const trackerDbPath = path.join(localAppData, 'Grindlog', 'tracker.db');
  const rawDbPath = path.join(localAppData, 'Grindlog', 'raw.db');

  if (!fs.existsSync(trackerDbPath)) return [];

  const dbTracker = new DatabaseSync(trackerDbPath, { readOnly: true });
  const dbRaw = fs.existsSync(rawDbPath) ? new DatabaseSync(rawDbPath, { readOnly: true }) : null;

  try {
    // Collect all friend names & IDs
    const friendNames = new Set<string>(['Rocinante_.', 'Mechless Madness', 'RudeTurkey7373', 'HulkingPen12238']);
    const friendPids = new Set<string>([
      'Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0',
      'Epic|7d1894456e94432a929fb2982478eb1d|0',
    ]);

    try {
      const gFriends = reader.getGrindlogFriends();
      for (const gf of gFriends) {
        if (gf.primary_id) friendPids.add(gf.primary_id);
        if (gf.nickname) friendNames.add(gf.nickname);
      }
    } catch {}

    if (cache) {
      try {
        const cFriends = cache.getCustomFriends();
        for (const cf of cFriends) {
          friendPids.add(cf.primary_id);
          friendNames.add(cf.name);
        }
      } catch {}
    }

    // Determine target friend set to filter by
    const hasExplicitFilter = Boolean(selectedFriends && selectedFriends.length > 0);
    const targetNames = new Set<string>();
    const targetPids = new Set<string>();

    if (hasExplicitFilter) {
      for (const item of selectedFriends!) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        targetNames.add(trimmed.toLowerCase());
        targetPids.add(trimmed);
        if (trimmed.toLowerCase() === 'mechless madness') {
          targetPids.add('Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0');
        }
        if (trimmed.toLowerCase() === 'rocinante_.') {
          targetPids.add('Epic|7d1894456e94432a929fb2982478eb1d|0');
        }
        if (trimmed.toLowerCase().includes('rudeturkey') || trimmed.toLowerCase().includes('hulkingpen') || trimmed.toLowerCase().includes('hulk')) {
          targetNames.add('rudeturkey7373');
          targetNames.add('hulkingpen12238');
        }
      }
      if (cache) {
        try {
          for (const cf of cache.getCustomFriends()) {
            if (targetNames.has(cf.name.toLowerCase()) || targetPids.has(cf.primary_id)) {
              targetNames.add(cf.name.toLowerCase());
              targetPids.add(cf.primary_id);
            }
          }
        } catch {}
      }
    } else {
      for (const fn of friendNames) targetNames.add(fn.toLowerCase());
      for (const fp of friendPids) targetPids.add(fp);
    }

    const nameClauses = Array.from(targetNames).map(t => `'${t.replace(/'/g, "''")}'`);
    const pidClauses = Array.from(targetPids).map(p => `'${p.replace(/'/g, "''")}'`);

    const filterCondition = [
      nameClauses.length > 0 ? `LOWER(p_friend.name) IN (${nameClauses.join(',')})` : null,
      pidClauses.length > 0 ? `p_friend.primary_id IN (${pidClauses.join(',')})` : null,
    ].filter(Boolean).join(' OR ');

    const matchQuery = `
      SELECT DISTINCT 
        m.guid, m.started_at, m.playlist_id, m.arena, m.score_team0, m.score_team1, m.winner_team_num,
        p_user.team_num as user_team
      FROM matches m
      JOIN match_players p_user ON m.guid = p_user.match_guid AND (p_user.name = 'Swapo_o' OR p_user.primary_id LIKE '%f5c0f37f0a5649e4bff607332fcf8ac0%')
      JOIN match_players p_friend ON m.guid = p_friend.match_guid AND p_friend.primary_id != p_user.primary_id
      WHERE p_user.team_num = p_friend.team_num
        AND (${filterCondition || '1=1'})
      ORDER BY m.started_at DESC
      LIMIT 100
    `;

    const matchRows = dbTracker.prepare(matchQuery).all() as Array<any>;
    if (matchRows.length === 0) return [];

    const matchPlayersStmt = dbTracker.prepare(`
      SELECT name, primary_id, team_num, goals, assists, saves, shots, demos, score, is_bot
      FROM match_players
      WHERE match_guid = ?
    `);

    const rawHitsStmt = dbRaw
      ? dbRaw.prepare("SELECT ts, data FROM events WHERE match_guid = ? AND name = 'BallHit' ORDER BY seq ASC")
      : null;

    const results: SquadExplorerMatch[] = [];

    for (const m of matchRows) {
      const allPlayers = matchPlayersStmt.all(m.guid) as Array<any>;
      const teamPlayers = allPlayers.filter(p => p.team_num === m.user_team);
      const friendsOnTeam = teamPlayers.filter(
        p => p.name !== 'Swapo_o' && (
          targetNames.has(p.name.toLowerCase()) ||
          friendNames.has(p.name) ||
          targetPids.has(p.primary_id) ||
          friendPids.has(p.primary_id)
        )
      );

      // If matchAll is specified and multiple friends selected, ensure all selected are present
      if (matchAll && hasExplicitFilter && selectedFriends!.length > 1) {
        const teamPlayerNamesLower = teamPlayers.map(p => p.name.toLowerCase());
        const allPresent = selectedFriends!.every(sf => {
          const sfLower = sf.toLowerCase();
          return teamPlayerNamesLower.includes(sfLower) || teamPlayers.some(p => p.primary_id === sf);
        });
        if (!allPresent) continue;
      }

      const teamSize = teamPlayers.length;
      const is2s = teamSize === 2 || m.playlist_id === 2 || m.playlist_id === 11;
      const is3s = teamSize === 3 || m.playlist_id === 13 || m.playlist_id === 3;
      const mode: '2v2 Doubles' | '3v3 Standard' | 'Other' = is2s ? '2v2 Doubles' : is3s ? '3v3 Standard' : 'Other';

      if (modeFilter === '2s' && !is2s) continue;
      if (modeFilter === '3s' && !is3s) continue;

      const isTeam0 = m.user_team === 0;
      const scoreTeam = isTeam0 ? m.score_team0 : m.score_team1;
      const scoreOpp = isTeam0 ? m.score_team1 : m.score_team0;
      const isWin = scoreTeam > scoreOpp;

      // Evaluate match via MatchAnalyzer so Squad Explorer shares the exact rule-aware ratings, double-commits, and errors
      let analyzed = null;
      try {
        analyzed = resolvedAnalyzer.analyzeMatch(m.guid, false);
      } catch {}

      const analyzedByPid = new Map((analyzed?.players || []).map(ap => [ap.primary_id, ap]));
      const analyzedByName = new Map((analyzed?.players || []).map(ap => [ap.name.toLowerCase(), ap]));

      // Calculate rating for each team player
      const evaluatedPlayers = teamPlayers.map(p => {
        const ap = analyzedByPid.get(p.primary_id) || analyzedByName.get((p.name || '').toLowerCase());
        const rating = ap
          ? ap.rating
          : calculateMatchRatingFromPlayerRow({
              goals: p.goals || 0,
              assists: p.assists || 0,
              saves: p.saves || 0,
              shots: p.shots || 0,
              demos: p.demos || 0,
              team_num: p.team_num,
              winner_team_num: m.winner_team_num,
              score_team0: m.score_team0,
              score_team1: m.score_team1,
            });
        return {
          name: p.name,
          rating,
          goals: p.goals || 0,
          assists: p.assists || 0,
          saves: p.saves || 0,
          shots: p.shots || 0,
          demos: p.demos || 0,
          score: p.score || 0,
        };
      });

      // Best player (highest rating)
      let bestPlayer = evaluatedPlayers[0]?.name || 'Swapo_o';
      let maxRating = -1;
      for (const ep of evaluatedPlayers) {
        if (ep.rating > maxRating) {
          maxRating = ep.rating;
          bestPlayer = ep.name;
        }
      }

      // Check double commits & errors leading to goal
      let matchDc = 0;
      let matchElg = 0;
      if (analyzed) {
        matchDc = (analyzed.double_commits || []).filter(dc => dc.team_num === m.user_team).length;
        matchElg = analyzed.players
          .filter(ap => ap.team_num === m.user_team)
          .reduce((sum, ap) => sum + (ap.errors_leading_to_goal || 0), 0);
      } else if (rawHitsStmt) {
        try {
          const hitRows = rawHitsStmt.all(m.guid) as Array<{ ts: number; data: string }>;
          const hits = hitRows.map(hr => {
            const d = JSON.parse(hr.data);
            return {
              ts: hr.ts,
              name: d.Players[0]?.Name,
              team: d.Players[0]?.TeamNum,
              x: d.Ball?.Location?.X ?? d.BallPosition?.X ?? 0,
              y: d.Ball?.Location?.Y ?? d.BallPosition?.Y ?? 0,
            };
          });

          for (let i = 0; i < hits.length - 1; i++) {
            const h1 = hits[i];
            const h2 = hits[i + 1];
            const dt = h2.ts - h1.ts;
            const dist = Math.hypot(h2.x - h1.x, h2.y - h1.y);
            if (h1.team === m.user_team && h2.team === m.user_team && h1.name !== h2.name && dt <= 750 && dist <= 900) {
              matchDc++;
            }
          }
        } catch {}
      }

      results.push({
        guid: m.guid,
        started_at: m.started_at,
        arena: m.arena,
        score_team: scoreTeam,
        score_opp: scoreOpp,
        is_win: isWin,
        friends_on_team: friendsOnTeam.map(f => f.name),
        all_teammates: teamPlayers.map(p => p.name),
        best_player: bestPlayer,
        players: evaluatedPlayers,
        double_commits: matchDc,
        errors_leading_to_goal: matchElg,
        mode,
        team_size: teamSize,
        playlist_id: m.playlist_id,
      });
    }

    return results;
  } finally {
    dbTracker.close();
    if (dbRaw) dbRaw.close();
  }
}
