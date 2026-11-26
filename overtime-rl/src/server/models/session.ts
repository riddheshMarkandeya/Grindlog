import type { MatchAnalysisResult, PodiumPlayer } from '../../shared/types.ts';

export interface FriendMatcher {
  friendIds: ReadonlySet<string>;
  friendNames: ReadonlySet<string>;
}

interface SessionPlayerAccumulator {
  name: string;
  primary_id: string;
  matches: number;
  wins: number;
  ratings: number[];
  goals: number;
  assists: number;
  saves: number;
  doubleCommits: number;
  xgs: number[];
  boosts: number[];
}

function isUserOrFriendPlayer(
  player: { is_user: boolean; primary_id: string; name: string },
  matcher: FriendMatcher
): boolean {
  if (player.is_user) return true;
  if (matcher.friendIds.has(player.primary_id)) return true;
  return matcher.friendNames.has(player.name.trim().toLowerCase());
}

/**
 * Computes squad-wide goals for/against and deduplicated team double-commit totals
 * across a list of analyzed session matches.
 */
export function computeSessionTeamTotals(analyses: MatchAnalysisResult[]): {
  totalGoalsFor: number;
  totalGoalsAgainst: number;
  totalDoubleCommits: number;
} {
  let totalGoalsFor = 0;
  let totalGoalsAgainst = 0;
  let totalDoubleCommits = 0;

  for (const analysis of analyses) {
    const userPlayer = analysis.players.find(p => p.is_user);
    const userTeamNum = analysis.user_team_num ?? (userPlayer ? userPlayer.team_num : null);

    if (userTeamNum === 1) {
      totalGoalsFor += analysis.score_team1;
      totalGoalsAgainst += analysis.score_team0;
    } else {
      totalGoalsFor += analysis.score_team0;
      totalGoalsAgainst += analysis.score_team1;
    }

    const teamCommits = (analysis.double_commits ?? []).filter(
      dc => userTeamNum === null || dc.team_num === userTeamNum
    );
    totalDoubleCommits += teamCommits.length;
  }

  return { totalGoalsFor, totalGoalsAgainst, totalDoubleCommits };
}

/**
 * Builds the Session Awards Player-of-the-Night podium strictly from the user
 * and pinned friends so random opponents and solo teammates never take podium slots.
 * Prefers players with 2+ session games, falling back to 1+ games if fewer than 3 qualify.
 */
export function buildSessionPodium(
  analyses: MatchAnalysisResult[],
  matcher: FriendMatcher
): PodiumPlayer[] {
  const playerStats = new Map<string, SessionPlayerAccumulator>();

  for (const analysis of analyses) {
    for (const p of analysis.players) {
      if (p.is_bot) continue;
      if (!isUserOrFriendPlayer(p, matcher)) continue;

      let stats = playerStats.get(p.player_key);
      if (!stats) {
        stats = {
          name: p.name,
          primary_id: p.primary_id,
          matches: 0,
          wins: 0,
          ratings: [],
          goals: 0,
          assists: 0,
          saves: 0,
          doubleCommits: 0,
          xgs: [],
          boosts: [],
        };
        playerStats.set(p.player_key, stats);
      }

      stats.matches += 1;
      if (analysis.winner_team_num === p.team_num) stats.wins += 1;
      stats.ratings.push(p.rating);
      stats.goals += p.goals;
      stats.assists += p.assists;
      stats.saves += p.saves;
      stats.doubleCommits += p.double_commits ?? 0;
      stats.xgs.push(p.xg);
      if (p.boost_avg) stats.boosts.push(p.boost_avg);
    }
  }

  const allCandidates: PodiumPlayer[] = Array.from(playerStats.entries())
    .map(([key, s]) => {
      const avgRating = Math.round((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length) * 10) / 10;
      const totalXG = Math.round(s.xgs.reduce((a, b) => a + b, 0) * 100) / 100;
      const avgBoost = s.boosts.length > 0
        ? Math.round(s.boosts.reduce((a, b) => a + b, 0) / s.boosts.length)
        : 50;

      return {
        player_key: key,
        primary_id: s.primary_id,
        name: s.name,
        matches_played: s.matches,
        win_rate: Math.round((s.wins / s.matches) * 100),
        avg_rating: avgRating,
        total_goals: s.goals,
        total_assists: s.assists,
        total_saves: s.saves,
        total_double_commits: s.doubleCommits,
        total_xg: totalXG,
        avg_boost: avgBoost,
      };
    })
    .sort((a, b) => b.avg_rating - a.avg_rating || b.matches_played - a.matches_played);

  const twoPlus = allCandidates.filter(p => p.matches_played >= 2);
  if (twoPlus.length >= 3) return twoPlus;

  const oneMatchFillers = allCandidates.filter(p => p.matches_played < 2);
  return [...twoPlus, ...oneMatchFillers];
}
