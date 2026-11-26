import React, { useState } from 'react';
import type { MatchPlayerAnalysis } from '../../shared/types.ts';
import { RatingBadge } from './RatingBadge.tsx';
import { RotationBadge } from './RotationBadge.tsx';

interface DetailedStatsTableProps {
  players: MatchPlayerAnalysis[];
  onSelectPlayer?: (player: MatchPlayerAnalysis) => void;
}

export const DetailedStatsTable: React.FC<DetailedStatsTableProps> = ({ players, onSelectPlayer }) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'shooting' | 'defense' | 'movement' | 'boost'>('all');

  const userPlayer = players.find(p => p.is_user || p.name === 'Swapo_o');
  const userTeamNum = userPlayer ? userPlayer.team_num : null;

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.team_num !== b.team_num) return a.team_num - b.team_num;
    return b.rating - a.rating;
  });

  return (
    <div
      className="surface-card"
      style={{
        padding: '20px',
        overflowX: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>Comprehensive Match Statistics</h3>
          <p style={{ fontSize: '12px', color: '#64748b' }}>In-depth telemetry breakdown across all game phases</p>
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: '6px', backgroundColor: '#0c121e', padding: '4px', borderRadius: '10px', border: '1px solid #1c273e', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'Overview' },
            { id: 'shooting', label: 'Shooting & xG' },
            { id: 'defense', label: 'Defense' },
            { id: 'movement', label: 'Pace & Zones' },
            { id: 'boost', label: 'Boost IQ' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as any)}
              style={{
                backgroundColor: activeCategory === cat.id ? '#1e2c47' : 'transparent',
                color: activeCategory === cat.id ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', tableLayout: 'auto' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #1e2c47', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ padding: '10px 8px' }}>Player</th>
            <th style={{ padding: '10px 4px', textAlign: 'center' }}>Rating</th>
            {/* Overview / Shooting Columns */}
            {(activeCategory === 'all' || activeCategory === 'shooting') && (
              <>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>G</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Sh</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Conv%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>xG</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Clin</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>km/h</th>
              </>
            )}
            {/* Playmaking & Defense Columns */}
            {(activeCategory === 'all' || activeCategory === 'defense') && (
              <>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>A</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>KP</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>BCC</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Sv</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Clr</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }} title="Double Commits">DC</th>
              </>
            )}
            {/* Movement & Field Zones Columns */}
            {(activeCategory === 'all' || activeCategory === 'movement') && (
              <>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Spd%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Def%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Mid%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Att%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Air</th>
              </>
            )}
            {/* Boost Columns */}
            {activeCategory === 'all' && (
              <>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Bst</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Pad%</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }} title="Opponent Boost Steals">Stl</th>
              </>
            )}
            {activeCategory === 'boost' && (
              <>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Avg Boost</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Empty (s)</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Empty %</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Small Pads</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Big Orbs</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }}>Pad Ratio %</th>
                <th style={{ padding: '10px 4px', textAlign: 'center' }} title="Opponent Boost Steals">Boost Steals</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((p, idx) => {
            const isBlue = p.team_num === 0;
            const isUserTeam = userTeamNum !== null && p.team_num === userTeamNum;
            return (
              <tr
                key={p.player_key}
                onClick={() => onSelectPlayer?.(p)}
                title={onSelectPlayer ? 'Click to inspect player titles, attributes & rating breakdown' : undefined}
                style={{
                  borderBottom: '1px solid #141f33',
                  backgroundColor: p.is_user ? 'rgba(56, 189, 248, 0.04)' : idx % 2 === 0 ? '#0f1728' : 'transparent',
                  cursor: onSelectPlayer ? 'pointer' : 'default',
                }}
              >
                <td style={{ padding: '10px 8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: isBlue ? '#38bdf8' : '#fb923c',
                          flexShrink: 0,
                        }}
                        title={isBlue ? 'Blue Side' : 'Orange Side'}
                      />
                      <span style={{ fontWeight: 800, color: p.is_user ? '#38bdf8' : '#f8fafc', whiteSpace: 'nowrap', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name} {p.is_user && '(You)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '13px', flexWrap: 'wrap' }}>
                      {userTeamNum !== null && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: isUserTeam ? '#065f46' : '#1e293b',
                            color: isUserTeam ? '#34d399' : '#94a3b8',
                            border: isUserTeam ? '1px solid #10b981' : '1px solid #334155',
                          }}
                        >
                          {isUserTeam ? 'TEAM' : 'OPP'}
                        </span>
                      )}
                      <span style={{ fontSize: '9px', color: '#64748b', padding: '1px 5px', backgroundColor: '#172238', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                        {p.radar.archetype}
                      </span>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                  <RatingBadge score={p.rating} size="sm" />
                </td>

                {/* Shooting Columns */}
                {(activeCategory === 'all' || activeCategory === 'shooting') && (
                  <>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 800, color: p.goals > 0 ? '#34d399' : '#94a3b8' }}>
                      {p.goals}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.shots}</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.shot_conversion_pct}%</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                      {p.xg.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: '10px 4px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: p.xg_diff >= 0 ? '#34d399' : '#f87171',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {p.xg_diff >= 0 ? `+${p.xg_diff.toFixed(2)}` : p.xg_diff.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>
                      {p.hardest_shot_kmh ? `${Math.round(p.hardest_shot_kmh)}` : '-'}
                    </td>
                  </>
                )}

                {/* Playmaking & Defense Columns */}
                {(activeCategory === 'all' || activeCategory === 'defense') && (
                  <>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: p.assists > 0 ? '#60a5fa' : '#94a3b8' }}>
                      {p.assists}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.key_passes}</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.big_chances_created}</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: p.saves > 0 ? '#38bdf8' : '#94a3b8' }}>
                      {p.saves}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.clearances}</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                      <RotationBadge count={p.double_commits || 0} fatalCount={p.fatal_double_commits || 0} size="sm" />
                    </td>
                  </>
                )}

                {/* Movement & Field Zones Columns */}
                {(activeCategory === 'all' || activeCategory === 'movement') && (
                  <>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: p.supersonic_pct >= 20 ? '#38bdf8' : '#cbd5e1' }}>
                      {p.supersonic_pct}%
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#94a3b8' }}>{p.touch_distribution.defence_pct}%</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#94a3b8' }}>{p.touch_distribution.midfield_pct}%</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#94a3b8' }}>{p.touch_distribution.attack_pct}%</td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#cbd5e1' }}>{p.aerial_touches}</td>
                  </>
                )}

                {/* Boost Columns */}
                {activeCategory === 'all' && (
                  <>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: '#f8fafc' }}>
                      {p.boost_avg ? Math.round(p.boost_avg) : '-'}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: p.pad_ratio_pct >= 70 ? '#34d399' : '#cbd5e1', fontWeight: 600 }}>
                      {p.pad_ratio_pct}%
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                      {p.boost_steals > 0 ? (
                        <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                          🔥 {p.boost_steals}
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}>-</span>
                      )}
                    </td>
                  </>
                )}
                {activeCategory === 'boost' && (
                  <>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: '#f8fafc' }}>
                      {p.boost_avg ? Math.round(p.boost_avg) : '-'}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: p.empty_boost_seconds > 20 ? '#f87171' : '#94a3b8' }}>
                      {p.empty_boost_seconds}s
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: p.empty_boost_pct > 10 ? '#f87171' : '#94a3b8' }}>
                      {p.empty_boost_pct}%
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {p.small_pads || 0}
                      </span>
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.25)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {p.big_orbs || 0}
                      </span>
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, color: p.pad_ratio_pct >= 70 ? '#34d399' : p.pad_ratio_pct >= 50 ? '#38bdf8' : '#fb923c' }}>
                      {p.pad_ratio_pct}%
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                      {p.boost_steals > 0 ? (
                        <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                          🔥 {p.boost_steals} steals
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}>0</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
