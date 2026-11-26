import React, { useState } from 'react';
import type { TrioSquadDossier } from '../../shared/types.ts';
import { formatArenaName } from '../../shared/formatters.ts';
import { RadarChart } from './RadarChart.tsx';
import { RatingBadge } from './RatingBadge.tsx';
import { RotationBadge } from './RotationBadge.tsx';

interface TrioSquadDossierViewProps {
  trio: TrioSquadDossier;
  onSelectMatch?: (guid: string) => void;
  onOpenProfile?: (primaryId: string) => void;
}

export const TrioSquadDossierView: React.FC<TrioSquadDossierViewProps> = ({
  trio,
  onSelectMatch,
  onOpenProfile,
}) => {
  const [matchFilter, setMatchFilter] = useState<'all' | 'wins' | 'losses'>('all');
  const [searchArena, setSearchArena] = useState<string>('');

  const filteredMatches = trio.matches
    .filter(m => {
      if (matchFilter === 'wins') return m.is_win;
      if (matchFilter === 'losses') return !m.is_win;
      return true;
    })
    .filter(m => (m.arena || '').toLowerCase().includes(searchArena.toLowerCase()));

  // Sorted players by rating
  const sortedByRating = [...trio.players].sort((a, b) => b.avg_rating - a.avg_rating);
  const sortedByGoals = [...trio.players].sort((a, b) => b.total_goals - a.total_goals);
  const sortedByAssists = [...trio.players].sort((a, b) => b.total_assists - a.total_assists);
  const sortedBySaves = [...trio.players].sort((a, b) => b.total_saves - a.total_saves);
  const sortedByMvps = [...trio.players].sort((a, b) => b.mvp_count - a.mvp_count);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Hero Dossier Banner */}
      <div
        className="surface-card-elevated"
        style={{
          padding: '24px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '20px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🛡️</span>
            <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#f8fafc', margin: 0, letterSpacing: '-0.02em' }}>
              3s Core Trio Roster
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: '#1e3a8a',
                color: '#60a5fa',
                border: '1px solid #3b82f6',
              }}
            >
              34 Mutual Matches
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#cbd5e1', margin: '6px 0 0 0', fontWeight: 600 }}>
            Swapo_o <span style={{ color: '#64748b' }}>•</span> Rocinante_. <span style={{ color: '#64748b' }}>•</span> Mechless Madness
          </p>
        </div>

        {/* Quick Trio Record Badges */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="surface-sub" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Trio Record</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#f8fafc', marginTop: '2px' }}>
              {trio.wins}W - {trio.losses}L
            </div>
          </div>
          <div className="surface-sub" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Win Rate</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: trio.win_rate >= 50 ? '#34d399' : '#fb923c', marginTop: '2px' }}>
              {trio.win_rate}%
            </div>
          </div>
          <div className="surface-sub" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Goal Differential</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: trio.goal_differential >= 0 ? '#34d399' : '#f87171', marginTop: '2px' }}>
              {trio.goal_differential >= 0 ? `+${trio.goal_differential}` : trio.goal_differential}
            </div>
          </div>
          <div className="surface-sub" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Double Commits</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#f59e0b', marginTop: '2px' }}>
              {trio.double_commits_per_game} <span style={{ fontSize: '12px', color: '#94a3b8' }}>/gm</span>
            </div>
          </div>
          <div className="surface-sub" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Third-Man Cover</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: (trio.third_man_coverage_pct ?? 78) >= 70 ? '#34d399' : '#fb923c', marginTop: '2px' }}>
              {trio.third_man_coverage_pct ?? 78}%
            </div>
          </div>
        </div>
      </div>

      {/* 2. Tactical Verdict & AI Insights */}
      <div
        className="surface-card"
        style={{
          padding: '20px 24px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
          🧠 Tactical Synergy Verdict & Rotation Diagnostics
        </div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', lineHeight: 1.5, marginBottom: '12px' }}>
          {trio.synergy_verdict}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px' }}>
          {trio.tactical_insights.map((insight, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: '#141d2f',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '12px',
                color: '#cbd5e1',
                lineHeight: 1.5,
              }}
            >
              • {insight}
            </div>
          ))}
        </div>
      </div>

      {/* 3. Who Did Better Overall? (Contribution Podiums) */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#f8fafc', margin: 0 }}>
            🏆 Who Did Better Overall? (Trio Contribution Rankings)
          </h3>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Head-to-head performance rankings across all 34 matches played together
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {/* Average FotMob Rating */}
          <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', border: '1px solid #233252', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '10px' }}>
              ⭐ Highest Avg Rating
            </div>
            {sortedByRating.map((p, idx) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <button
                  type="button"
                  onClick={() => onOpenProfile?.(p.primary_id)}
                  title={`Open ${p.name}'s Full Career Profile & Attributes`}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: onOpenProfile ? 'pointer' : 'default',
                    fontSize: '13px',
                    fontWeight: p.is_user ? 800 : 600,
                    color: p.is_user ? '#38bdf8' : '#e2e8f0',
                    textAlign: 'left',
                    textDecoration: onOpenProfile ? 'underline dotted rgba(148,163,184,0.45)' : 'none',
                    textUnderlineOffset: '3px',
                  }}
                >
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.name} {p.is_user && '(You)'}
                </button>
                <RatingBadge score={p.avg_rating} size="sm" />
              </div>
            ))}
          </div>

          {/* Game MVPs (Best on Team) */}
          <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', border: '1px solid #233252', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginBottom: '10px' }}>
              👑 Trio Game MVPs
            </div>
            {sortedByMvps.map((p, idx) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: p.is_user ? 800 : 600, color: p.is_user ? '#38bdf8' : '#e2e8f0' }}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.name}
                </span>
                <span style={{ fontWeight: 800, color: '#f59e0b', fontSize: '13px' }}>
                  {p.mvp_count} <span style={{ fontSize: '10px', color: '#64748b' }}>({Math.round((p.mvp_count / 34) * 100)}%)</span>
                </span>
              </div>
            ))}
          </div>

          {/* Goals */}
          <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', border: '1px solid #233252', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#10b981', textTransform: 'uppercase', marginBottom: '10px' }}>
              ⚽ Goals Scored
            </div>
            {sortedByGoals.map((p, idx) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: p.is_user ? 800 : 600, color: p.is_user ? '#38bdf8' : '#e2e8f0' }}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.name}
                </span>
                <span style={{ fontWeight: 800, color: '#34d399', fontSize: '13px' }}>
                  {p.total_goals} <span style={{ fontSize: '10px', color: '#64748b' }}>({p.goals_per_game}/gm)</span>
                </span>
              </div>
            ))}
          </div>

          {/* Assists */}
          <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', border: '1px solid #233252', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', marginBottom: '10px' }}>
              🎯 Assists Created
            </div>
            {sortedByAssists.map((p, idx) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: p.is_user ? 800 : 600, color: p.is_user ? '#38bdf8' : '#e2e8f0' }}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.name}
                </span>
                <span style={{ fontWeight: 800, color: '#60a5fa', fontSize: '13px' }}>
                  {p.total_assists} <span style={{ fontSize: '10px', color: '#64748b' }}>({p.assists_per_game}/gm)</span>
                </span>
              </div>
            ))}
          </div>

          {/* Saves */}
          <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', border: '1px solid #233252', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', marginBottom: '10px' }}>
              🧤 Saves & Clearances
            </div>
            {sortedBySaves.map((p, idx) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: p.is_user ? 800 : 600, color: p.is_user ? '#38bdf8' : '#e2e8f0' }}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.name}
                </span>
                <span style={{ fontWeight: 800, color: '#c084fc', fontSize: '13px' }}>
                  {p.total_saves} <span style={{ fontSize: '10px', color: '#64748b' }}>({p.saves_per_game}/gm)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Side-by-Side 3-Way Tactical Radars (Clickable to Open Full Profile) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {trio.players.map(p => (
          <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <RadarChart
              radar={p.radar}
              playerName={`${p.name}${p.is_user ? ' (You)' : ''}`}
              size={310}
            />
            {onOpenProfile && p.primary_id && (
              <button
                onClick={() => onOpenProfile(p.primary_id)}
                style={{
                  backgroundColor: '#141d2f',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#38bdf8',
                  borderRadius: '10px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                👤 View {p.name}'s Full Career Profile & Attributes →
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 5. Passing Network & Double-Commit Hotspots */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        {/* Triangle Passing Network */}
        <div className="surface-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              📐 Squad Passing Network (Who Assists Whom)
            </h4>
            <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
              Conversion Matrix
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {trio.passing_network.map((conn, idx) => {
              const matrixEntry = trio.passing_matrix?.find(m => m.passer === conn.passer && m.receiver === conn.scorer);
              return (
                <div
                  key={idx}
                  className="surface-sub"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>
                    <span style={{ color: '#38bdf8', fontWeight: 800 }}>{conn.passer}</span> ➔{' '}
                    <span style={{ color: '#34d399', fontWeight: 800 }}>{conn.scorer}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {matrixEntry && matrixEntry.conversion_pct > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: matrixEntry.conversion_pct >= 50 ? '#34d399' : '#38bdf8', backgroundColor: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                        {matrixEntry.conversion_pct}% Conv
                      </span>
                    )}
                    <div style={{ fontSize: '14px', fontWeight: 900, color: '#f8fafc' }}>
                      {conn.assists} <span style={{ fontSize: '11px', color: '#64748b' }}>Assists</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Intra-Squad Collision Hotspots */}
        <div className="surface-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              💥 Intra-Squad Double-Commit Hotspots
            </h4>
            <span style={{ fontSize: '11px', color: '#fb923c', fontWeight: 700, backgroundColor: 'rgba(251, 146, 60, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(251, 146, 60, 0.2)' }}>
              Tailing Encroachments
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {trio.intra_double_commits.map((item, idx) => {
              const pct = Math.round((item.count / (trio.total_double_commits || 1)) * 100);
              const isHigh = idx === 0;
              return (
                <div
                  key={idx}
                  className="surface-sub"
                  style={{
                    borderColor: isHigh ? '#ef4444' : undefined,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: isHigh ? '#f87171' : '#e2e8f0' }}>
                      {item.pair}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 900, color: isHigh ? '#ef4444' : '#f59e0b' }}>
                      {item.count} <span style={{ fontSize: '11px', color: '#64748b' }}>({pct}%)</span>
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ width: '100%', height: '6px', backgroundColor: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        backgroundColor: isHigh ? '#ef4444' : idx === 1 ? '#f59e0b' : '#10b981',
                        borderRadius: '3px',
                      }}
                    />
                  </div>
                  {/* Asymmetric Encroachment Attribution */}
                  {(item.p1_encroached !== undefined || item.p2_encroached !== undefined) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
                      <span>{item.p1_name || 'P1'} encroached: <strong style={{ color: '#f8fafc' }}>{item.p1_encroached ?? 0}</strong></span>
                      <span>{item.p2_name || 'P2'} encroached: <strong style={{ color: '#f8fafc' }}>{item.p2_encroached ?? 0}</strong></span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 6. Per-Game Comparative Match Log ("Who Did Better Per Game") */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
        }}
      >
        {/* Pinned Card Toolbar: Spans 100% width, never displaced by table scroll */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Per-Game Match Log & Side-by-Side Ratings ({filteredMatches.length} Matches)
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
              Compare how all 3 players performed in every single 3s match. Click any row to load replay in Match Center.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter arena..."
              value={searchArena}
              onChange={e => setSearchArena(e.target.value)}
              style={{
                backgroundColor: '#141d2f',
                border: '1px solid #233252',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                color: '#ffffff',
                outline: 'none',
                width: '140px',
              }}
            />
            {(['all', 'wins', 'losses'] as const).map(f => (
              <button
                key={f}
                onClick={() => setMatchFilter(f)}
                style={{
                  backgroundColor: matchFilter === f ? '#1e3a8a' : '#141d2f',
                  color: matchFilter === f ? '#60a5fa' : '#94a3b8',
                  border: matchFilter === f ? '1px solid #3b82f6' : '1px solid #233252',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 0.15s ease',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Match Table Container - Responsive without horizontal scroll */}
        <div
          style={{
            width: '100%',
            overflowX: 'hidden',
            borderRadius: '10px',
            border: '1px solid #1a253c',
            backgroundColor: '#0c1322',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1a253c', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Match</th>
                <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Arena & Date</th>
                <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>MVP</th>
                <th style={{ padding: '10px 6px', textAlign: 'center', color: '#38bdf8', whiteSpace: 'nowrap' }}>Swapo_o (You)</th>
                <th style={{ padding: '10px 6px', textAlign: 'center', color: '#a78bfa', whiteSpace: 'nowrap' }}>Rocinante_.</th>
                <th style={{ padding: '10px 6px', textAlign: 'center', color: '#34d399', whiteSpace: 'nowrap' }}>Mechless</th>
                <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>Defense / DC</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map(m => {
                const uStat = m.players.find(p => p.name === 'Swapo_o');
                const rStat = m.players.find(p => p.name === 'Rocinante_.');
                const mStat = m.players.find(p => p.name === 'Mechless Madness');

                return (
                  <tr
                    key={m.guid}
                    onClick={() => onSelectMatch && onSelectMatch(m.guid)}
                    style={{
                      borderBottom: '1px solid #141f33',
                      cursor: onSelectMatch ? 'pointer' : 'default',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#162238')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: m.is_win ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: m.is_win ? '#34d399' : '#f87171',
                            border: m.is_win ? '1px solid #10b981' : '1px solid #ef4444',
                          }}
                        >
                          {m.is_win ? 'WIN' : 'LOSS'}
                        </span>
                        <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '12px' }}>
                          {m.score_team} - {m.score_opp}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                        {formatArenaName(m.arena)}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>
                        {new Date(m.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {new Date(m.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: '#1e293b',
                          color: '#f59e0b',
                          border: '1px solid rgba(217, 119, 6, 0.5)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        👑 {m.best_player.slice(0, 8)}
                      </span>
                    </td>
                    {/* Swapo_o stat */}
                    <td style={{ padding: '8px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <RatingBadge score={uStat?.rating ?? 6.0} size="sm" />
                        <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                          {uStat?.goals ?? 0}G {uStat?.assists ?? 0}A
                        </span>
                      </div>
                    </td>
                    {/* Rocinante stat */}
                    <td style={{ padding: '8px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <RatingBadge score={rStat?.rating ?? 6.0} size="sm" />
                        <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                          {rStat?.goals ?? 0}G {rStat?.assists ?? 0}A
                        </span>
                      </div>
                    </td>
                    {/* Mechless stat */}
                    <td style={{ padding: '8px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <RatingBadge score={mStat?.rating ?? 6.0} size="sm" />
                        <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                          {mStat?.goals ?? 0}G {mStat?.assists ?? 0}A
                        </span>
                      </div>
                    </td>
                    {/* Double commits / Errors */}
                    <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <RotationBadge count={m.double_commits} elgCount={m.errors_leading_to_goal || 0} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
