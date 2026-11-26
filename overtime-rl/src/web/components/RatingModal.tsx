import React, { useEffect } from 'react';
import type { MatchAnalysisResult, MatchPlayerAnalysis, RatingFactor, RatingFactorCategory } from '../../shared/types.ts';
import { getPlayerMatchTitles } from '../../shared/awards.ts';
import { RatingBadge } from './RatingBadge.tsx';
import { OvrBadge } from './OvrBadge.tsx';

interface RatingModalProps {
  player: MatchPlayerAnalysis | null;
  awards?: MatchAnalysisResult['awards'];
  onOpenProfile?: (primaryId: string) => void;
  onClose: () => void;
}

const CATEGORY_CONFIG: Record<
  RatingFactorCategory,
  { label: string; icon: string; color: string }
> = {
  attack: { label: 'Attacking & xG', icon: '🏆', color: '#38bdf8' },
  defense: { label: 'Defending & Duels', icon: '🛡️', color: '#818cf8' },
  goalkeeping: { label: 'Goalkeeping & Saves', icon: '🧤', color: '#34d399' },
  possession: { label: 'Passing & Playmaking', icon: '🎯', color: '#a78bfa' },
  turnover_recovery: { label: 'Counter-Press & Recoveries', icon: '⚡', color: '#f59e0b' },
  discipline: { label: 'Motor & Physicality', icon: '💥', color: '#ec4899' },
  clutch: { label: 'Match Outcome & Clutch', icon: '🔥', color: '#f97316' },
};

const CATEGORY_ORDER: RatingFactorCategory[] = [
  'attack',
  'defense',
  'goalkeeping',
  'possession',
  'turnover_recovery',
  'discipline',
  'clutch',
];

function getAttrColor(val: number): string {
  if (val >= 75) return '#34d399';
  if (val >= 55) return '#38bdf8';
  if (val >= 40) return '#fbbf24';
  return '#94a3b8';
}

export const RatingModal: React.FC<RatingModalProps> = ({ player, awards, onOpenProfile, onClose }) => {
  useEffect(() => {
    if (!player) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [player, onClose]);

  if (!player) return null;

  const titles = getPlayerMatchTitles(player.name, awards);

  // Group factors by category
  const groupedFactors = new Map<RatingFactorCategory | 'other', RatingFactor[]>();

  for (const factor of player.rating_factors) {
    const cat = factor.category ?? 'other';
    const list = groupedFactors.get(cat) || [];
    list.push(factor);
    groupedFactors.set(cat, list);
  }

  const positiveTotal = player.rating_factors
    .filter(f => f.delta > 0)
    .reduce((sum, f) => sum + f.delta, 0);
  const negativeTotal = player.rating_factors
    .filter(f => f.delta < 0)
    .reduce((sum, f) => sum + f.delta, 0);

  const radarAttrs = [
    { label: 'Finishing', value: player.radar.finishing },
    { label: 'Creation', value: player.radar.creation },
    { label: 'Defense', value: player.radar.defense },
    { label: 'Motor', value: player.radar.motor },
    { label: 'Physicality', value: player.radar.physicality },
    { label: 'Boost IQ', value: player.radar.boost_iq },
    { label: 'Aerial', value: player.radar.aerial ?? 0 },
    { label: 'Discipline', value: player.radar.positioning ?? 74 },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(4, 7, 14, 0.78)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="surface-card-elevated"
        style={{
          borderRadius: '18px',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #1a253c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, #151f36 0%, #101726 100%)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: player.team_num === 0 ? '#38bdf8' : '#fb923c',
                }}
              />
              <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#ffffff', margin: 0 }}>
                {player.name} {player.is_user && <span style={{ color: '#38bdf8', fontSize: '14px' }}>(You)</span>}
              </h3>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
                  color: '#ffffff',
                }}
              >
                {player.radar.archetype}
              </span>
              <OvrBadge radar={player.radar} />
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
              Player Match Dossier • Earned Titles, Tactical Attributes & Rating Breakdown
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {!player.is_bot && player.primary_id && onOpenProfile && (
              <button
                onClick={() => {
                  onOpenProfile(player.primary_id);
                  onClose();
                }}
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={`View ${player.name}'s full Career Profile & 8-Axis Attributes`}
              >
                👤 Career Profile →
              </button>
            )}
            <RatingBadge score={player.rating} size="lg" />
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Dossier Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* 1. Earned Match Titles */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              🏅 Match Titles & Accolades ({titles.length})
            </div>
            {titles.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {titles.map(t => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      borderRadius: '10px',
                      backgroundColor: t.bg,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    <span style={{ fontSize: '15px' }}>{t.icon}</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: t.color, lineHeight: 1.2 }}>{t.title}</div>
                      {t.detail && (
                        <div style={{ fontSize: '10px', color: '#cbd5e1', opacity: 0.85, marginTop: '1px' }}>{t.detail}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#64748b', backgroundColor: '#0c121e', padding: '10px 14px', borderRadius: '8px', border: '1px solid #1a253c' }}>
                Solid shift — no individual match award plaques claimed in this fixture.
              </div>
            )}
          </div>

          {/* 2. Compact Box Score & Boost Telemetry Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px',
            }}
          >
            {[
              { label: 'G / A / Sv', val: `${player.goals} / ${player.assists} / ${player.saves}`, color: '#f8fafc' },
              { label: 'xG (Clin)', val: `${player.xg.toFixed(2)} (${player.xg_diff >= 0 ? '+' : ''}${player.xg_diff.toFixed(2)})`, color: player.xg_diff >= 0 ? '#34d399' : '#f87171' },
              { label: 'Key Pass / BCC', val: `${player.key_passes} / ${player.big_chances_created}`, color: '#93c5fd' },
              { label: 'Boost / Steals', val: `${player.boost_avg ? Math.round(player.boost_avg) : '-'} avg / ${player.boost_steals}🔥`, color: '#fbbf24' },
            ].map((stat, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#0c121e',
                  border: '1px solid #1c273e',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: stat.color, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{stat.val}</div>
              </div>
            ))}
          </div>

          {/* 3. 8-Axis Tactical Attributes Grid */}
          <div style={{ backgroundColor: '#0c121e', border: '1px solid #1c273e', borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                📊 Match Tactical Attributes (0–99)
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                DCs: <strong style={{ color: player.double_commits > 0 ? '#f59e0b' : '#34d399' }}>{player.double_commits}</strong>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
              {radarAttrs.map(attr => {
                const c = getAttrColor(attr.value);
                return (
                  <div key={attr.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                      <span style={{ color: '#cbd5e1', fontWeight: 700 }}>{attr.label}</span>
                      <span style={{ color: c, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{attr.value}</span>
                    </div>
                    <div style={{ width: '100%', height: '5px', backgroundColor: '#172238', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${attr.value}%`, height: '100%', backgroundColor: c, borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Starting Baseline & Delta Summary Strip */}
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#0c121e',
              borderRadius: '10px',
              border: '1px solid #1a253c',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#64748b' }}>FotMob Baseline:</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#e2e8f0' }}>6.00</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: '#34d399', fontWeight: 700 }}>+{positiveTotal.toFixed(2)}</span>
              <span style={{ color: '#f87171', fontWeight: 700 }}>{negativeTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* 5. Categorized Factor Content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {CATEGORY_ORDER.map(catKey => {
              const factors = groupedFactors.get(catKey);
              if (!factors || factors.length === 0) return null;
              const config = CATEGORY_CONFIG[catKey];

              return (
                <div key={catKey}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '11px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: config.color,
                      marginBottom: '6px',
                    }}
                  >
                    <span>{config.icon}</span>
                    <span>{config.label}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {factors.map((f, i) => {
                      const isPositive = f.delta > 0;
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: '#121a2c',
                            borderRadius: '8px',
                            borderLeft: `3px solid ${isPositive ? '#10b981' : '#ef4444'}`,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: '#e2e8f0' }}>{f.name}</span>
                            {f.clutchMultiplier && f.clutchMultiplier > 1 && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  backgroundColor: 'rgba(249, 115, 22, 0.2)',
                                  color: '#fb923c',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(249, 115, 22, 0.3)',
                                }}
                              >
                                ⚡ {f.clutchMultiplier}x Clutch
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: isPositive ? '#34d399' : '#f87171',
                            }}
                          >
                            {isPositive ? `+${f.delta.toFixed(2)}` : f.delta.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Uncategorized Fallback */}
            {groupedFactors.get('other') && groupedFactors.get('other')!.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                    marginBottom: '6px',
                  }}
                >
                  Other Factors
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {groupedFactors.get('other')!.map((f, i) => {
                    const isPositive = f.delta > 0;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          backgroundColor: '#121a2c',
                          borderRadius: '8px',
                          borderLeft: `3px solid ${isPositive ? '#10b981' : '#ef4444'}`,
                        }}
                      >
                        <span style={{ fontSize: '12px', color: '#e2e8f0' }}>{f.name}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: isPositive ? '#34d399' : '#f87171',
                          }}
                        >
                          {isPositive ? `+${f.delta.toFixed(2)}` : f.delta.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
