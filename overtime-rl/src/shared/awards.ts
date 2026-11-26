import type { MatchAnalysisResult } from './types.ts';

export interface PlayerTitleBadge {
  id: string;
  icon: string;
  title: string;
  detail?: string;
  color: string;
  bg: string;
  border: string;
  isNegative?: boolean;
}

function matchesPlayerAward(awardText: string | null | undefined, playerName: string): { matched: boolean; detail?: string } {
  if (!awardText || !playerName) return { matched: false };
  const trimmed = awardText.trim();
  if (trimmed === playerName) {
    return { matched: true };
  }
  const parenPrefix = `${playerName} (`;
  if (trimmed.startsWith(parenPrefix) && trimmed.endsWith(')')) {
    return {
      matched: true,
      detail: trimmed.slice(parenPrefix.length, -1),
    };
  }
  return { matched: false };
}

export function getPlayerMatchTitles(
  playerName: string,
  awards?: MatchAnalysisResult['awards']
): PlayerTitleBadge[] {
  if (!awards || !playerName) return [];
  const list: PlayerTitleBadge[] = [];

  const potm = matchesPlayerAward(awards.player_of_the_match, playerName);
  if (potm.matched) {
    list.push({
      id: 'potm',
      icon: '⭐',
      title: 'Player of the Match',
      detail: 'Highest FotMob Match Rating',
      color: '#34d399',
      bg: 'rgba(16, 185, 129, 0.14)',
      border: 'rgba(16, 185, 129, 0.45)',
    });
  }

  const sniper = matchesPlayerAward(awards.the_sniper, playerName);
  if (sniper.matched) {
    list.push({
      id: 'sniper',
      icon: '🎯',
      title: 'The Sniper',
      detail: 'Top xG Clinical Finisher',
      color: '#c084fc',
      bg: 'rgba(168, 85, 247, 0.14)',
      border: 'rgba(168, 85, 247, 0.45)',
    });
  }

  const wall = matchesPlayerAward(awards.the_iron_wall, playerName);
  if (wall.matched) {
    list.push({
      id: 'iron_wall',
      icon: '🧱',
      title: 'The Iron Wall',
      detail: 'Top Defensive Anchor',
      color: '#38bdf8',
      bg: 'rgba(2, 132, 199, 0.14)',
      border: 'rgba(2, 132, 199, 0.45)',
    });
  }

  const speed = matchesPlayerAward(awards.speed_demon, playerName);
  if (speed.matched) {
    list.push({
      id: 'speed_demon',
      icon: '⚡',
      title: 'Speed Demon',
      detail: speed.detail,
      color: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.14)',
      border: 'rgba(56, 189, 248, 0.45)',
    });
  }

  const playmaker = matchesPlayerAward(awards.the_playmaker, playerName);
  if (playmaker.matched) {
    list.push({
      id: 'playmaker',
      icon: '🎩',
      title: 'The Playmaker',
      detail: playmaker.detail,
      color: '#93c5fd',
      bg: 'rgba(96, 165, 250, 0.14)',
      border: 'rgba(96, 165, 250, 0.45)',
    });
  }

  const goblin = matchesPlayerAward(awards.the_boost_goblin, playerName);
  if (goblin.matched) {
    list.push({
      id: 'boost_goblin',
      icon: '🔋',
      title: 'Boost Goblin',
      detail: goblin.detail,
      color: '#6ee7b7',
      bg: 'rgba(52, 211, 153, 0.14)',
      border: 'rgba(52, 211, 153, 0.45)',
    });
  }

  const air = matchesPlayerAward(awards.air_marshal, playerName);
  if (air.matched) {
    list.push({
      id: 'air_marshal',
      icon: '✈️',
      title: 'Air Marshal',
      detail: air.detail,
      color: '#d8b4fe',
      bg: 'rgba(192, 132, 252, 0.14)',
      border: 'rgba(192, 132, 252, 0.45)',
    });
  }

  const enforcer = matchesPlayerAward(awards.the_enforcer, playerName);
  if (enforcer.matched) {
    list.push({
      id: 'enforcer',
      icon: '💥',
      title: 'The Enforcer',
      detail: enforcer.detail,
      color: '#f87171',
      bg: 'rgba(239, 68, 68, 0.14)',
      border: 'rgba(239, 68, 68, 0.45)',
    });
  }

  const magnet = matchesPlayerAward(awards.crossbar_magnet, playerName);
  if (magnet.matched) {
    list.push({
      id: 'crossbar_magnet',
      icon: '🧲',
      title: 'Crossbar Magnet',
      detail: 'Woodwork Hits Leader',
      color: '#facc15',
      bg: 'rgba(234, 179, 8, 0.14)',
      border: 'rgba(234, 179, 8, 0.45)',
    });
  }

  if (awards.double_trouble) {
    const [pairPart, detailPart] = awards.double_trouble.split(' (');
    const pairNames = pairPart.split(' & ').map(s => s.trim());
    if (pairNames.includes(playerName)) {
      const partner = pairNames.find(n => n !== playerName);
      const countLabel = detailPart ? detailPart.replace(')', '') : 'Double Commits';
      list.push({
        id: 'double_trouble',
        icon: '⚠️',
        title: 'Double Trouble',
        detail: partner ? `with ${partner} • ${countLabel}` : countLabel,
        color: '#fb923c',
        bg: 'rgba(249, 115, 22, 0.14)',
        border: 'rgba(249, 115, 22, 0.45)',
        isNegative: true,
      });
    }
  }

  return list;
}
