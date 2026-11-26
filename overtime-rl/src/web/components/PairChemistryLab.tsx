import React, { useEffect, useMemo, useState } from 'react';
import type { PairChemistryOverview, PairChemistryRecord } from '../../shared/types.ts';

interface PairChemistryLabProps {
  onOpenProfile?: (primaryId: string) => void;
}

const PILLAR_META: Array<{
  key: keyof PairChemistryRecord['pillars'];
  label: string;
  weight: string;
  hint: string;
}> = [
  {
    key: 'passing_synergy',
    label: 'Passing & Goal Links',
    weight: '25%',
    hint: 'Direct assists between A & B + shared creation radar',
  },
  {
    key: 'spacing_discipline',
    label: 'Spacing & Anti-Double-Commit',
    weight: '25%',
    hint: 'Mutual double-commits/gm + 3rd-man defensive safety covers',
  },
  {
    key: 'role_complementarity',
    label: 'Role Complementarity',
    weight: '20%',
    hint: 'Striker/Finisher vs Playmaker/Anchor balance vs dual-chaser clashes',
  },
  {
    key: 'tempo_sync',
    label: 'Tempo & Boost Sync',
    weight: '15%',
    hint: 'Supersonic rhythm match + boost reserve stability',
  },
  {
    key: 'impact_lift',
    label: 'Sample-Weighted Win Lift',
    weight: '15%',
    hint: 'Bayes-stabilized m/(m+12) win rate, rating & GD delta over solo baselines',
  },
];

function getChemColor(score: number): string {
  if (score >= 76) return '#34d399';
  if (score >= 64) return '#38bdf8';
  if (score >= 52) return '#fbbf24';
  return '#f87171';
}

function renderDiamonds(diamonds: number, color: string) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }} title={`${diamonds}/3 EA FC Link Diamonds`}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '9px',
            height: '9px',
            transform: 'rotate(45deg)',
            borderRadius: '1.5px',
            backgroundColor: i < diamonds ? color : 'rgba(148, 163, 184, 0.18)',
            border: `1px solid ${i < diamonds ? color : 'rgba(148, 163, 184, 0.35)'}`,
            boxShadow: i < diamonds ? `0 0 8px ${color}66` : 'none',
          }}
        />
      ))}
    </span>
  );
}

/**
 * Interactive 5-Pillar Pairwise Rocket League Chemistry explorer for comparing compatible vs clashing duos.
 */
export const PairChemistryLab: React.FC<PairChemistryLabProps> = ({ onOpenProfile }) => {
  const [modeFilter, setModeFilter] = useState<'all' | '2v2' | '3v3'>('all');
  const [overview, setOverview] = useState<PairChemistryOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedPairKey, setSelectedPairKey] = useState<string>('');
  const [playerAId, setPlayerAId] = useState<string>('');
  const [playerBId, setPlayerBId] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/squad/chemistry?mode=${modeFilter}`)
      .then(res => res.json())
      .then((data: PairChemistryOverview) => {
        setOverview(data);
        if (data.pairs.length > 0) {
          const initial = data.pairs[0];
          setSelectedPairKey(prev =>
            data.pairs.some(p => p.pair_key === prev) ? prev : initial.pair_key
          );
          setPlayerAId(prev => (data.players.some(pl => pl.primary_id === prev) ? prev : initial.player_a.primary_id));
          setPlayerBId(prev => (data.players.some(pl => pl.primary_id === prev) ? prev : initial.player_b.primary_id));
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load pairwise chemistry:', err);
        setLoading(false);
      });
  }, [modeFilter]);

  const activePair = useMemo(() => {
    if (!overview || overview.pairs.length === 0) return null;
    if (playerAId && playerBId && playerAId !== playerBId) {
      const bySelection = overview.pairs.find(
        p =>
          (p.player_a.primary_id === playerAId && p.player_b.primary_id === playerBId) ||
          (p.player_a.primary_id === playerBId && p.player_b.primary_id === playerAId)
      );
      if (bySelection) return bySelection;
    }
    return overview.pairs.find(p => p.pair_key === selectedPairKey) || overview.pairs[0];
  }, [overview, playerAId, playerBId, selectedPairKey]);

  const selectPair = (pair: PairChemistryRecord) => {
    setSelectedPairKey(pair.pair_key);
    setPlayerAId(pair.player_a.primary_id);
    setPlayerBId(pair.player_b.primary_id);
  };

  if (loading && !overview) {
    return (
      <div className="surface-card" style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
        Calculating 5-Pillar Pairwise Chemistry across squad matches...
      </div>
    );
  }

  if (!overview || overview.pairs.length === 0) {
    return (
      <div className="surface-card" style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
        Not enough mutual matches in this mode filter yet to evaluate pairwise chemistry.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header + Mode Filter */}
      <div
        className="surface-card-elevated"
        style={{
          padding: '22px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            Pairwise Chemistry Lab (5-Pillar Engine)
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
            Measures which two teammates click vs collide across Passing, Spacing/Anti-DC, Role Complementarity, Tempo Sync & Bayes Win Lift.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px', backgroundColor: 'rgba(15, 23, 42, 0.75)', padding: '4px', borderRadius: '10px', border: '1px solid rgba(148, 163, 184, 0.16)' }}>
          {(['all', '2v2', '3v3'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setModeFilter(mode)}
              style={{
                padding: '6px 14px',
                borderRadius: '7px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 800,
                backgroundColor: modeFilter === mode ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: modeFilter === mode ? '#38bdf8' : '#94a3b8',
              }}
            >
              {mode === 'all' ? 'All Modes' : mode === '2v2' ? '2v2 Doubles' : '3v3 Standard'}
            </button>
          ))}
        </div>
      </div>

      {/* Best Works vs Tactical Friction Split */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <div
          className="surface-card"
          style={{
            padding: '18px 20px',
            borderColor: 'rgba(52, 211, 153, 0.28)',
            background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.9))',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 900, color: '#34d399', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Best Compatible Duos
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Highest Synergy</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {overview.best_pairs.map(pair => {
              const col = getChemColor(pair.chemistry_score);
              return (
                <button
                  key={pair.pair_key}
                  type="button"
                  onClick={() => selectPair(pair)}
                  style={{
                    textAlign: 'left',
                    padding: '12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    border:
                      activePair?.pair_key === pair.pair_key
                        ? `1px solid ${col}`
                        : '1px solid rgba(148, 163, 184, 0.16)',
                    backgroundColor: 'rgba(15, 23, 42, 0.72)',
                    color: '#f8fafc',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>
                      {pair.player_a.display_name} × {pair.player_b.display_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {renderDiamonds(pair.diamonds, col)}
                      <span style={{ fontWeight: 900, fontSize: '14px', color: col, fontFamily: 'var(--font-mono)' }}>
                        {pair.chemistry_score}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    {pair.matches_together}G · {pair.win_rate}% WR ({pair.win_rate_lift_pct >= 0 ? `+${pair.win_rate_lift_pct}` : pair.win_rate_lift_pct}% lift) · {pair.double_commits_per_game} DC/gm · {pair.role_pairing_label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          className="surface-card"
          style={{
            padding: '18px 20px',
            borderColor: 'rgba(248, 113, 113, 0.28)',
            background: 'linear-gradient(180deg, rgba(244, 63, 94, 0.08), rgba(15, 23, 42, 0.9))',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 900, color: '#fb7185', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Clash / Friction Watchlist
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Needs Adjustment</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {overview.friction_pairs.map(pair => {
              const col = getChemColor(pair.chemistry_score);
              return (
                <button
                  key={pair.pair_key}
                  type="button"
                  onClick={() => selectPair(pair)}
                  style={{
                    textAlign: 'left',
                    padding: '12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    border:
                      activePair?.pair_key === pair.pair_key
                        ? `1px solid ${col}`
                        : '1px solid rgba(148, 163, 184, 0.16)',
                    backgroundColor: 'rgba(15, 23, 42, 0.72)',
                    color: '#f8fafc',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>
                      {pair.player_a.display_name} × {pair.player_b.display_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {renderDiamonds(pair.diamonds, col)}
                      <span style={{ fontWeight: 900, fontSize: '14px', color: col, fontFamily: 'var(--font-mono)' }}>
                        {pair.chemistry_score}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    {pair.matches_together}G · {pair.double_commits_per_game} DC/gm · {pair.frictions[0]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Interactive Player A x Player B Selector & 5-Pillar Deep Breakdown */}
      <div className="surface-card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '16px', fontWeight: 900, color: '#f8fafc' }}>
            Inspect Any Two Players
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select
              aria-label="Select Player A"
              value={playerAId}
              onChange={e => setPlayerAId(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {overview.players.map(pl => (
                <option key={pl.primary_id} value={pl.primary_id}>
                  {pl.display_name} ({pl.ovr} {pl.role_badge})
                </option>
              ))}
            </select>
            <span style={{ color: '#64748b', fontWeight: 900 }}>×</span>
            <select
              aria-label="Select Player B"
              value={playerBId}
              onChange={e => setPlayerBId(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {overview.players.map(pl => (
                <option key={pl.primary_id} value={pl.primary_id}>
                  {pl.display_name} ({pl.ovr} {pl.role_badge})
                </option>
              ))}
            </select>
          </div>
        </div>

        {activePair ? (
          <>
            {playerAId &&
              playerBId &&
              playerAId !== playerBId &&
              !(
                (activePair.player_a.primary_id === playerAId && activePair.player_b.primary_id === playerBId) ||
                (activePair.player_a.primary_id === playerBId && activePair.player_b.primary_id === playerAId)
              ) && (
                <div style={{ fontSize: '12px', color: '#fbbf24', backgroundColor: 'rgba(251, 191, 36, 0.08)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(251, 191, 36, 0.22)' }}>
                  Selected players do not share enough same-team matches in this mode yet; showing closest available pair below.
                </div>
              )}

            {/* Matchup Summary Banner */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                gap: '16px',
                padding: '16px',
                borderRadius: '12px',
                backgroundColor: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img
                  src={`/cars/${activePair.player_a.car_body === 'hybrid' ? 'fennec' : activePair.player_a.car_body}.png`}
                  alt={activePair.player_a.car_body}
                  style={{ width: '56px', height: '40px', objectFit: 'contain' }}
                />
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenProfile?.(activePair.player_a.primary_id)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenProfile ? 'pointer' : 'default', color: '#f8fafc', fontSize: '16px', fontWeight: 900 }}
                  >
                    {activePair.player_a.display_name}
                  </button>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {activePair.player_a.ovr} OVR · {activePair.player_a.archetype}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '28px', fontWeight: 900, color: getChemColor(activePair.chemistry_score), fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                  {activePair.chemistry_score}
                </div>
                <div style={{ marginTop: '6px' }}>{renderDiamonds(activePair.diamonds, getChemColor(activePair.chemistry_score))}</div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: getChemColor(activePair.chemistry_score), marginTop: '4px' }}>
                  {activePair.tier_label} · {activePair.role_pairing_label}
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                  {activePair.matches_together}G ({activePair.wins}W-{activePair.losses}L · {activePair.win_rate}% WR · {activePair.confidence_pct}% Conf)
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', textAlign: 'right' }}>
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenProfile?.(activePair.player_b.primary_id)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenProfile ? 'pointer' : 'default', color: '#f8fafc', fontSize: '16px', fontWeight: 900 }}
                  >
                    {activePair.player_b.display_name}
                  </button>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {activePair.player_b.ovr} OVR · {activePair.player_b.archetype}
                  </div>
                </div>
                <img
                  src={`/cars/${activePair.player_b.car_body === 'hybrid' ? 'fennec' : activePair.player_b.car_body}.png`}
                  alt={activePair.player_b.car_body}
                  style={{ width: '56px', height: '40px', objectFit: 'contain' }}
                />
              </div>
            </div>

            {/* 5 Pillar Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {PILLAR_META.map(meta => {
                const val = activePair.pillars[meta.key];
                const barColor = getChemColor(val);
                return (
                  <div key={meta.key} style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(15, 23, 42, 0.55)', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#e2e8f0' }}>
                        {meta.label} <span style={{ color: '#64748b', fontWeight: 600 }}>({meta.weight})</span>
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 900, color: barColor, fontFamily: 'var(--font-mono)' }}>{val}</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(148, 163, 184, 0.14)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${val}%`, height: '100%', backgroundColor: barColor, borderRadius: '4px' }} />
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px' }}>{meta.hint}</div>
                  </div>
                );
              })}
            </div>

            {/* Insights & Mode Splits */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                <div style={{ fontSize: '11px', fontWeight: 900, color: '#34d399', textTransform: 'uppercase', marginBottom: '6px' }}>Why They Click</div>
                {activePair.strengths.map((s, i) => (
                  <div key={i} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>• {s}</div>
                ))}
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(244, 63, 94, 0.06)', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
                <div style={{ fontSize: '11px', fontWeight: 900, color: '#fb7185', textTransform: 'uppercase', marginBottom: '6px' }}>Collision & Friction Zones</div>
                {activePair.frictions.map((f, i) => (
                  <div key={i} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>• {f}</div>
                ))}
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                <div style={{ fontSize: '11px', fontWeight: 900, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '6px' }}>Tactical Fix & Mode Split</div>
                <div style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '8px' }}>{activePair.coaching_tip}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {activePair.mode_splits.map(ms => (
                    <span key={ms.mode} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', backgroundColor: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(148, 163, 184, 0.2)', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
                      {ms.mode.toUpperCase()}: {ms.chemistry_score} SYN ({ms.matches_together}G, {ms.win_rate}% WR)
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* All Pairs Comparison Table */}
      <div className="surface-card" style={{ padding: '20px 24px', overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 900, color: '#f8fafc' }}>
          All Ranked Teammate Pairs ({overview.pairs.length})
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid rgba(148, 163, 184, 0.16)' }}>
              <th style={{ padding: '8px' }}>Pair</th>
              <th style={{ padding: '8px' }}>Role Fit</th>
              <th style={{ padding: '8px' }}>Games</th>
              <th style={{ padding: '8px' }}>Win% (Lift)</th>
              <th style={{ padding: '8px' }}>Goal Links</th>
              <th style={{ padding: '8px' }}>DC/gm</th>
              <th style={{ padding: '8px' }}>Link</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>SYN</th>
            </tr>
          </thead>
          <tbody>
            {overview.pairs.map(pair => {
              const col = getChemColor(pair.chemistry_score);
              const selected = activePair?.pair_key === pair.pair_key;
              return (
                <tr
                  key={pair.pair_key}
                  onClick={() => selectPair(pair)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: selected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                  }}
                >
                  <td style={{ padding: '10px 8px', fontWeight: 800, color: '#f8fafc' }}>
                    {pair.player_a.display_name} × {pair.player_b.display_name}
                  </td>
                  <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>{pair.role_pairing_label}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>{pair.matches_together}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>
                    {pair.win_rate}% ({pair.win_rate_lift_pct >= 0 ? `+${pair.win_rate_lift_pct}` : pair.win_rate_lift_pct}%)
                  </td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>{pair.total_goal_links}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', color: pair.double_commits_per_game >= 0.34 ? '#fb7185' : '#34d399' }}>
                    {pair.double_commits_per_game}
                  </td>
                  <td style={{ padding: '10px 8px' }}>{renderDiamonds(pair.diamonds, col)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 900, fontFamily: 'var(--font-mono)', color: col }}>
                    {pair.chemistry_score}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
