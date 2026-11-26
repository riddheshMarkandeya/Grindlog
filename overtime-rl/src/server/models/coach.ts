import type { MatchPlayerAnalysis, MatchAnalysisResult, PlayerCoachReport, CoachPoint } from '../../shared/types.ts';

function formatClock(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.floor(Math.max(0, sec) % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function generateCoachReport(
  player: MatchPlayerAnalysis,
  match: MatchAnalysisResult
): PlayerCoachReport {
  const isWin = match.winner_team_num !== null && player.team_num === match.winner_team_num;
  const rating = player.rating;

  // 1. Generate Verdict & Summary Headline
  let verdict = 'Balanced Performance';
  let verdictSummary = '';

  if (rating >= 8.5) {
    if (player.goals >= 3 || player.xg_diff >= 1.0) {
      verdict = 'Elite Striking & Match Winner';
      verdictSummary = `Dominant performance with ${player.goals} goals and clinical execution, heavily driving your team's offense.`;
    } else if (player.saves >= 3 || (player.touches_defence > player.touches_attack)) {
      verdict = 'Masterclass Defensive Anchor';
      verdictSummary = `Impenetrable defensive presence with ${player.saves} saves and disciplined backfield rotation.`;
    } else {
      verdict = 'High-Impact All-Rounder';
      verdictSummary = `Flawless balance across all tactical thirds, controlling match momentum and pace.`;
    }
  } else if (rating >= 7.2) {
    if (isWin) {
      verdict = 'Solid & Reliable Victory';
      verdictSummary = `Played cleanly within the rotation with strong contributions in key possession phases.`;
    } else {
      verdict = 'Valiant Effort Despite Defeat';
      verdictSummary = `Put up strong individual numbers and defensive resistance despite team scoreline adversity.`;
    }
  } else if (rating >= 5.8) {
    verdict = 'Contested Game with Tactical Gaps';
    verdictSummary = `Decent spells of play mixed with moments of boost starvation or rotation hesitations.`;
  } else {
    verdict = 'Challenging Match Under Severe Pressure';
    verdictSummary = `Struggled to establish possession, plagued by defensive pressure and transition turnovers.`;
  }

  // 2. Strengths Detection
  const strengths: CoachPoint[] = [];

  // A. Clinical Finishing
  const playerGoals = match.shots.filter(s => s.player_name === player.name && s.outcome === 'goal');
  const primeGoal = playerGoals.length > 0 ? playerGoals[0] : null;

  if (player.goals > 0 && player.xg_diff >= 0.2) {
    const timeCallout = primeGoal ? ` At [${formatClock(primeGoal.time_seconds)}], converted a clinical ${primeGoal.speed_kmh} km/h strike (${primeGoal.xg.toFixed(2)} xG).` : '';
    strengths.push({
      tag: 'Finishing',
      title: 'Clinical Finishing Precision',
      description: `Scored ${player.goals} goal${player.goals > 1 ? 's' : ''} from ${player.xg.toFixed(2)} xG (+${player.xg_diff.toFixed(2)} clinicality).${timeCallout} You converted low-percentage looks with high shot placement.`,
      impact: 'high',
    });
  } else if (player.goals >= 2) {
    const timeCallout = primeGoal ? ` Opened scoring at [${formatClock(primeGoal.time_seconds)}] (${primeGoal.speed_kmh} km/h).` : '';
    strengths.push({
      tag: 'Finishing',
      title: 'Reliable Goal Scoring',
      description: `Bagged ${player.goals} goals on ${player.shots} shots (${player.shot_conversion_pct}% conversion).${timeCallout} Maintained constant goalmouth danger.`,
      impact: 'high',
    });
  }

  // A2. Boost Stealing & Starvation
  if ((player.boost_steals || 0) >= 1) {
    strengths.push({
      tag: 'Boost Denial',
      title: 'Opponent Boost Starvation',
      description: `Executed ${player.boost_steals} opponent corner 100-orb thefts deep in the attacking third, suffocating enemy counter-attack options.`,
      impact: 'medium',
    });
  }

  // B. Motor & Pace
  if (player.supersonic_pct >= 20) {
    strengths.push({
      tag: 'Pace & Motor',
      title: 'High-Tempo Transition Speed',
      description: `Spent ${player.supersonic_seconds}s (${player.supersonic_pct}%) in supersonic speed. Your rotation recoveries and contest challenges repeatedly beat opponents to 50/50s.`,
      impact: 'medium',
    });
  }

  // C. Defensive Tenacity
  if (player.saves >= 2 || player.clearances >= 4) {
    strengths.push({
      tag: 'Defense',
      title: 'Clutch Goalmouth Protection',
      description: `Recorded ${player.saves} save${player.saves > 1 ? 's' : ''} and ${player.clearances} clears, neutralizing opponent scoring runs.`,
      impact: 'high',
    });
  }

  // D. Playmaking & Vision
  if (player.assists >= 1 || player.key_passes >= 2 || player.big_chances_created >= 1) {
    strengths.push({
      tag: 'Playmaking',
      title: 'Creative Field Vision',
      description: `Created ${player.big_chances_created} big chance${player.big_chances_created !== 1 ? 's' : ''} and ${player.key_passes} key pass${player.key_passes !== 1 ? 'es' : ''}, generating prime shooting lanes for teammates.`,
      impact: 'medium',
    });
  }

  // E. Boost Discipline
  if ((player.boost_avg ?? 0) >= 55 && player.empty_boost_pct <= 6) {
    strengths.push({
      tag: 'Boost IQ',
      title: 'Disciplined Resource Routing',
      description: `Maintained a healthy ${Math.round(player.boost_avg ?? 0)} average boost while spending only ${player.empty_boost_seconds}s empty, ensuring you were rarely caught flat-footed.`,
      impact: 'medium',
    });
  }

  // F. Physicality & Demos
  if (player.demos >= 2) {
    strengths.push({
      tag: 'Physicality',
      title: 'Disruptive Physical Play',
      description: `Delivered ${player.demos} demolitions, removing defenders from the play and opening uncontested lanes.`,
      impact: 'medium',
    });
  }

  // G. Power Shot Prowess
  if (player.hardest_shot_kmh && player.hardest_shot_kmh >= 105) {
    strengths.push({
      tag: 'Power',
      title: 'Thunderous Shot Velocity',
      description: `Fired an explosive shot at ${Math.round(player.hardest_shot_kmh)} km/h that severely tested the opponent's defensive reactions.`,
      impact: 'low',
    });
  }

  // Ensure at least 1 strength
  if (strengths.length === 0) {
    strengths.push({
      tag: 'Work Rate',
      title: 'Solid Field Involvement',
      description: `Accumulated ${player.touches} total ball touches and ${player.score} match points, staying engaged in game flow.`,
      impact: 'low',
    });
  }

  // 3. Areas for Improvement Detection
  const improvements: CoachPoint[] = [];

  // A. Boost Starvation
  if (player.empty_boost_pct >= 10 || player.empty_boost_seconds >= 25) {
    improvements.push({
      tag: 'Boost Routing',
      title: 'Excessive Boost Starvation',
      description: `Spent ${player.empty_boost_seconds}s (${player.empty_boost_pct}% of the match) completely out of boost. Focus on pathing through small boost pad lines on rotation rather than driving out of position for 100-orbs.`,
      impact: 'high',
    });
  }

  // B. Wasteful Finishing / Big Chances Missed
  const missedBc = match.shots.find(s => s.player_name === player.name && s.is_big_chance && s.outcome !== 'goal');
  if (player.big_chances_missed >= 1 || (player.shots >= 3 && player.goals === 0)) {
    const timeCallout = missedBc ? ` At [${formatClock(missedBc.time_seconds)}], missed a prime scoring look (${missedBc.xg.toFixed(2)} xG).` : '';
    improvements.push({
      tag: 'Shot Selection',
      title: 'Unconverted Scoring Opportunities',
      description: `Missed ${player.big_chances_missed} big scoring chance${player.big_chances_missed > 1 ? 's' : ''} (${player.goals} goals on ${player.shots} shots).${timeCallout} Consider taking a controlled ground-bounce shot or faking rather than rushing low-percentage aerials.`,
      impact: 'high',
    });
  }

  // C. Low Pace / Sluggish Recovery
  if (player.supersonic_pct <= 12) {
    improvements.push({
      tag: 'Movement & Speed',
      title: 'Lethargic Match Pace',
      description: `Only ${player.supersonic_pct}% of your match was spent at supersonic speed. Practice incorporating speed flips, diagonal flips off walls, and wave dashes to maintain momentum without expending boost.`,
      impact: 'medium',
    });
  }

  // D. Defensive Third Neglect / Tunnel Vision
  if (player.touch_distribution.defence_pct <= 18 && match.score_team0 + match.score_team1 >= 4) {
    improvements.push({
      tag: 'Positioning',
      title: 'Forward Bias & Defensive Absence',
      description: `Only ${player.touch_distribution.defence_pct}% of your touches occurred in the defensive third. Ensure you are completing back-post rotations instead of cutting into midfield challenges.`,
      impact: 'high',
    });
  }

  // E. Offensive Over-Commitment
  if (player.touch_distribution.attack_pct >= 60 && player.goals <= 1 && !isWin) {
    improvements.push({
      tag: 'Rotation',
      title: 'Over-Extending on Offense',
      description: `${player.touch_distribution.attack_pct}% of touches were in the attack third, but yield was low. Over-committing forward leaves your backline exposed to counter-attack pinches.`,
      impact: 'medium',
    });
  }

  // F. Low Aerial Challenges
  if (player.aerial_touches === 0 && player.touches >= 25) {
    improvements.push({
      tag: 'Mechanics',
      title: 'Ground Bound / Zero Aerial Presence',
      description: `Registered 0 aerial touches throughout regulation. Incorporate fast-aerial mechanics to contest high rebounds before opponents read the trajectory.`,
      impact: 'low',
    });
  }

  // G. Defensive Turnovers / Errors Leading to Goal
  if ((player.turnover_concessions || 0) >= 1) {
    improvements.push({
      tag: 'Goalmouth Security',
      title: 'Fatal Turnover in Defensive Third',
      description: `Surrendered possession ${player.turnover_concessions} time${player.turnover_concessions > 1 ? 's' : ''} deep in your own goalmouth/back-wall that opponent converted into a goal. In tight spots, prioritize booming clears to corners rather than soft touches back into center traffic.`,
      impact: 'high',
    });
  }

  // G2. Fatal Double-Commit / Tailing Overcommit
  const fatalDc = match.double_commits?.find(dc => dc.instigator_name === player.name && dc.is_fatal);
  if (fatalDc) {
    improvements.push({
      tag: 'Spacing & Rotation',
      title: 'Fatal Tailing Double-Commit',
      description: `At [${formatClock(fatalDc.time_seconds)}]: Tailed active ball-carrier into contested space instead of holding secondary rotational depth, conceding an open-net counter breakaway. Maintain 1500+ units of separation behind first man.`,
      impact: 'high',
    });
  }

  // Ensure at least 1 coaching improvement point
  if (improvements.length === 0) {
    improvements.push({
      tag: 'Efficiency',
      title: 'Refine 50/50 Challenge Recovery',
      description: `Focus on winning the bounce trajectory on midfield 50/50s and flipping into boost lanes immediately upon landing.`,
      impact: 'low',
    });
  }

  return {
    player_name: player.name,
    is_user: player.is_user,
    rating: player.rating,
    verdict,
    verdict_summary: verdictSummary,
    strengths,
    improvements,
  };
}
