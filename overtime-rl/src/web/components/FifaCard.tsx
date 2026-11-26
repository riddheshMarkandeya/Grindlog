import React, { useState } from 'react';
import type { CarBodyType, FifaCardData } from '../../shared/types.ts';
import { exportSingleFifaCardPng, getFifaTierPalette } from '../utils/fifa-card-canvas.ts';

interface FifaCardProps {
  card: FifaCardData;
  size?: 'md' | 'sm';
  editable?: boolean;
  showShare?: boolean;
  showCycleBar?: boolean;
  onCardUpdated?: (nextCard: FifaCardData) => void;
  onClick?: () => void;
}

const CAR_OPTIONS: Array<{ id: CarBodyType; label: string }> = [
  { id: 'octane', label: 'Octane' },
  { id: 'fennec', label: 'Fennec' },
  { id: 'dominus', label: 'Dominus' },
  { id: 'breakout', label: 'Breakout' },
  { id: 'hybrid', label: 'Hybrid' },
];

const CarSvg: React.FC<{ carBody: CarBodyType; stroke: string; glow: string; width: number }> = ({
  carBody,
  stroke,
  glow,
  width,
}) => {
  const path =
    carBody === 'fennec'
      ? 'M 22 64 L 24 38 L 38 34 L 62 12 L 98 14 L 122 36 L 144 40 L 146 64 Z'
      : carBody === 'dominus'
      ? 'M 12 62 L 16 42 L 36 40 L 60 18 L 96 18 L 126 38 L 154 44 L 152 62 Z'
      : carBody === 'breakout'
      ? 'M 8 62 L 14 44 L 50 22 L 94 20 L 132 40 L 154 48 L 150 62 Z'
      : 'M 20 64 L 26 40 L 16 24 L 38 26 L 46 38 L 70 14 L 102 16 L 126 40 L 146 46 L 146 64 Z';

  return (
    <svg viewBox="0 0 168 82" style={{ width: `${width}px`, height: 'auto', overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={`boost-${carBody}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={glow} stopOpacity="0" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.65" />
        </linearGradient>
      </defs>
      <polygon points="-24,42 26,48 26,60 -18,62" fill={`url(#boost-${carBody})`} />
      <path d={path} fill="rgba(9, 14, 23, 0.55)" stroke={stroke} strokeWidth="3.2" strokeLinejoin="round" />
      <circle cx="44" cy="64" r="11" fill="#090e17" stroke={glow} strokeWidth="2.8" />
      <circle cx="118" cy="64" r="11" fill="#090e17" stroke={glow} strokeWidth="2.8" />
    </svg>
  );
};

function renderDelta(delta: number, compact = false) {
  if (!delta) return null;
  const color = delta > 0 ? '#34d399' : '#f87171';
  return (
    <span
      style={{
        fontSize: compact ? '9px' : '10px',
        fontWeight: 900,
        color,
        fontFamily: 'var(--font-mono)',
        marginLeft: '3px',
      }}
    >
      {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}

/**
 * Interactive EA FC / FIFA Ultimate Team Shield Card powered by discrete 15-game Rating Cycles
 * and the single canonical 8-axis Unified FIFA+RL Engine.
 */
export const FifaCard: React.FC<FifaCardProps> = ({
  card,
  size = 'md',
  editable = false,
  showShare = false,
  showCycleBar = true,
  onCardUpdated,
  onClick,
}) => {
  const [tilt, setTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [carDraft, setCarDraft] = useState<CarBodyType>(card.car_body);
  const [nameDraft, setNameDraft] = useState(card.display_name);
  const [titleDraft, setTitleDraft] = useState(card.card_title);

  const pal = getFifaTierPalette(card.tier);
  const isSmall = size === 'sm';
  const cardWidth = isSmall ? 228 : 292;
  const shieldClip = 'polygon(50% 0%, 91% 4%, 100% 10%, 100% 74%, 85% 91%, 50% 100%, 15% 91%, 0% 74%, 0% 10%, 9% 4%)';

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: Math.round(-y * 10 * 10) / 10, ry: Math.round(x * 12 * 10) / 10 });
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/card/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_id: card.primary_id,
          car_body: carDraft,
          custom_name: nameDraft.trim() || null,
          custom_title: titleDraft.trim() || null,
        }),
      }).then(r => r.json());
      if (res.card && onCardUpdated) {
        onCardUpdated(res.card);
      }
      setEditing(false);
    } catch (err) {
      console.error('Failed to save FIFA card prefs:', err);
    } finally {
      setSaving(false);
    }
  };

  const leftStats = [
    { label: 'PAC', val: card.stats.pac, delta: card.stat_deltas.pac, title: 'Transition Pace (net-to-net velocity & blitz breaks)' },
    { label: 'SHO', val: card.stats.sho, delta: card.stat_deltas.sho, title: 'Finishing (goals, shot conversion & xG overperformance)' },
    { label: 'PAS', val: card.stats.pas, delta: card.stat_deltas.pas, title: 'Creation (assists, key passes & favorable deliveries)' },
  ];
  const rightStats = [
    { label: 'DRI', val: card.stats.dri, delta: card.stat_deltas.dri, title: 'Dribbling (multi-touch carries, take-ons & solo dribble goals)' },
    { label: 'TAC', val: card.stats.tac, delta: card.stat_deltas.tac, title: 'Tackling (50/50 duel wins, dispossessions & shadow challenges)' },
    { label: 'GK', val: card.stats.gk, delta: card.stat_deltas.gk, title: 'Goalkeeping (xG prevented, saves & safe clears)' },
  ];

  const cycleTooltip = card.cycle.is_provisional
    ? `Provisional Card (${card.cycle.total_matches}/${card.cycle.cycle_size} matches) — full 15-game lock begins at Match #${card.cycle.cycle_size}`
    : `Locked to Cycle #${card.cycle.current_cycle} (Matches #${card.cycle.window_start_match}–#${card.cycle.window_end_match}). Stats hold steady until ${card.cycle.matches_until_refresh} more match${card.cycle.matches_until_refresh === 1 ? '' : 'es'}.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: `${cardWidth}px`, flexShrink: 0 }}>
      {/* Outer Foil Shield Shell */}
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
        onClick={onClick}
        title={cycleTooltip}
        style={{
          width: `${cardWidth}px`,
          padding: '2px',
          clipPath: shieldClip,
          background: `linear-gradient(145deg, ${pal.borderOuter}, ${pal.borderInner}, ${pal.borderOuter})`,
          boxShadow: `0 18px 40px -10px rgba(0, 0, 0, 0.7), 0 0 22px ${pal.accent}33`,
          transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          transition: 'transform 0.14s ease-out, box-shadow 0.2s ease',
          cursor: onClick ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: '100%',
            clipPath: shieldClip,
            background: `linear-gradient(170deg, ${pal.bgTop} 0%, ${pal.bgMid} 52%, ${pal.bgBot} 100%)`,
            padding: isSmall ? '14px 14px 20px' : '18px 18px 26px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {/* Promo Edition Top Tag */}
          <div
            style={{
              fontSize: isSmall ? '8px' : '9px',
              fontWeight: 900,
              letterSpacing: '0.14em',
              color: pal.textMuted,
              marginBottom: isSmall ? '4px' : '6px',
              textTransform: 'uppercase',
            }}
          >
            {card.promo_edition}
          </div>

          {/* Upper Row: OVR + Pos (left) | Car Vector (center-right) | Cycle Crest (right) */}
          <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span style={{ fontSize: isSmall ? '34px' : '44px', fontWeight: 900, color: pal.textMain, fontFamily: 'var(--font-mono)', letterSpacing: '-0.04em' }}>
                  {card.ovr}
                </span>
                {renderDelta(card.stat_deltas.ovr, true)}
              </div>
              <span style={{ fontSize: isSmall ? '12px' : '15px', fontWeight: 900, color: pal.textMuted, marginTop: '2px', letterSpacing: '0.06em' }}>
                {card.position}
              </span>
              <span
                style={{
                  marginTop: '6px',
                  fontSize: '8px',
                  fontWeight: 800,
                  padding: '2px 5px',
                  borderRadius: '4px',
                  backgroundColor: pal.ribbonBg,
                  color: pal.textMain,
                  border: `1px solid ${pal.borderInner}`,
                }}
              >
                {card.car_body.toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                <span
                  style={{
                    fontSize: isSmall ? '8px' : '9px',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: pal.accent,
                    backgroundColor: 'rgba(9, 14, 23, 0.45)',
                    padding: '2px 6px',
                    borderRadius: '6px',
                    border: `1px solid ${pal.accent}55`,
                  }}
                >
                  {card.cycle.is_provisional
                    ? `PROV ${card.cycle.total_matches}/${card.cycle.cycle_size}`
                    : `CYCLE #${card.cycle.current_cycle}`}
                </span>
              </div>
              <div style={{ marginTop: isSmall ? '6px' : '10px', marginRight: isSmall ? '4px' : '6px' }}>
                <CarSvg carBody={card.car_body} stroke={pal.borderOuter} glow={pal.accent} width={isSmall ? 108 : 138} />
              </div>
            </div>
          </div>

          {/* Nameplate Metallic Ribbon */}
          <div
            style={{
              width: '94%',
              marginTop: isSmall ? '8px' : '12px',
              padding: isSmall ? '5px 8px' : '6px 10px',
              backgroundColor: pal.ribbonBg,
              borderTop: `1px solid ${pal.borderOuter}55`,
              borderBottom: `1px solid ${pal.borderOuter}55`,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: isSmall ? '15px' : '18px',
                fontWeight: 900,
                color: pal.textMain,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {card.display_name}
            </div>
            <div
              style={{
                fontSize: isSmall ? '8px' : '9px',
                fontWeight: 800,
                color: pal.textMuted,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginTop: '1px',
              }}
            >
              {card.card_title}
            </div>
          </div>

          {/* Classic 2x3 FUT Core Stats */}
          <div
            style={{
              width: '86%',
              display: 'grid',
              gridTemplateColumns: '1fr 1px 1fr',
              gap: '8px',
              marginTop: isSmall ? '8px' : '12px',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: isSmall ? '2px' : '4px' }}>
              {leftStats.map(s => (
                <div key={s.label} title={s.title} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '5px' }}>
                  <span style={{ fontSize: isSmall ? '15px' : '18px', fontWeight: 900, color: pal.textMain, fontFamily: 'var(--font-mono)' }}>
                    {s.val}
                  </span>
                  <span style={{ fontSize: isSmall ? '10px' : '11px', fontWeight: 800, color: pal.textMuted }}>{s.label}</span>
                  {renderDelta(s.delta, isSmall)}
                </div>
              ))}
            </div>

            <div style={{ width: '1px', height: isSmall ? '48px' : '60px', backgroundColor: `${pal.borderOuter}44` }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: isSmall ? '2px' : '4px' }}>
              {rightStats.map(s => (
                <div key={s.label} title={s.title} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '5px' }}>
                  <span style={{ fontSize: isSmall ? '15px' : '18px', fontWeight: 900, color: pal.textMain, fontFamily: 'var(--font-mono)' }}>
                    {s.val}
                  </span>
                  <span style={{ fontSize: isSmall ? '10px' : '11px', fontWeight: 800, color: pal.textMuted }}>{s.label}</span>
                  {renderDelta(s.delta, isSmall)}
                </div>
              ))}
            </div>
          </div>

          {/* Secondary Axes + Total Power Strip */}
          <div
            style={{
              marginTop: isSmall ? '8px' : '10px',
              fontSize: isSmall ? '9px' : '10px',
              fontWeight: 800,
              color: pal.textMuted,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            AER {card.stats.aer} · DIS {card.stats.dis} · {card.total800}/800
          </div>

          {/* Hexagonal PlayStyles & PlayStyle+ */}
          {card.playstyles.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: isSmall ? '8px' : '10px', flexWrap: 'wrap' }}>
              {card.playstyles.map(ps => (
                <span
                  key={ps.id}
                  title={`${ps.name}${ps.tier === 'plus' ? '+' : ''} — ${ps.metric_label}`}
                  style={{
                    fontSize: isSmall ? '8px' : '9px',
                    fontWeight: 900,
                    padding: isSmall ? '2px 6px' : '3px 8px',
                    borderRadius: '6px',
                    backgroundColor: ps.tier === 'plus' ? 'rgba(251, 191, 36, 0.22)' : 'rgba(15, 23, 42, 0.45)',
                    color: ps.tier === 'plus' ? '#fbbf24' : pal.textMain,
                    border: ps.tier === 'plus' ? '1px solid #fbbf24' : `1px solid ${pal.borderOuter}66`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                  }}
                >
                  <span>{ps.icon}</span>
                  <span>
                    {ps.name}
                    {ps.tier === 'plus' ? '+' : ''}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 15-Game Rating Cycle Lock Progress & Card Controls */}
      {(showCycleBar || editable || showShare) && (
        <div className="surface-sub" style={{ width: '100%', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {showCycleBar && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                  {card.cycle.is_provisional
                    ? `Provisional (${card.cycle.total_matches}/${card.cycle.cycle_size}G)`
                    : `Cycle #${card.cycle.current_cycle} (#${card.cycle.window_start_match}–#${card.cycle.window_end_match})`}
                </span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                  {card.cycle.is_provisional
                    ? `${card.cycle.matches_until_refresh}G to Cycle #1`
                    : `${card.cycle.progress_in_cycle}/${card.cycle.cycle_size}G`}
                </span>
              </div>
              <div style={{ width: '100%', height: '5px', backgroundColor: '#090e17', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round((card.cycle.progress_in_cycle / Math.max(1, card.cycle.cycle_size)) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                    borderRadius: '3px',
                  }}
                />
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {card.cycle.is_provisional
                  ? `Unlocks locked ${card.cycle.cycle_size}-game drop in ${card.cycle.matches_until_refresh} match${card.cycle.matches_until_refresh === 1 ? '' : 'es'}.`
                  : `Refreshes in ${card.cycle.matches_until_refresh} game${card.cycle.matches_until_refresh === 1 ? '' : 's'} (Cycle #${card.cycle.current_cycle + 1}).`}
              </div>
            </div>
          )}

          {(editable || showShare) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {editable && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setCarDraft(card.car_body);
                    setNameDraft(card.display_name);
                    setTitleDraft(card.card_title);
                    setEditing(!editing);
                  }}
                  style={{
                    flex: 1,
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '6px 8px',
                    borderRadius: '7px',
                    backgroundColor: '#141d2f',
                    border: '1px solid #334155',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  {editing ? 'Close Editor' : '🏎️ Edit Car / Name'}
                </button>
              )}
              {showShare && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    exportSingleFifaCardPng(card, () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 3000);
                    });
                  }}
                  style={{
                    flex: 1,
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '6px 8px',
                    borderRadius: '7px',
                    backgroundColor: copied ? '#10b981' : '#5865F2',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied Card!' : 'Share Discord Card'}
                </button>
              )}
            </div>
          )}

          {editing && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                paddingTop: '8px',
                borderTop: '1px solid var(--border-hairline)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Car Body
                <select
                  value={carDraft}
                  onChange={e => setCarDraft(e.target.value as CarBodyType)}
                  style={{
                    width: '100%',
                    marginTop: '3px',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#090e17',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    fontSize: '11px',
                  }}
                >
                  {CAR_OPTIONS.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Card Name
                <input
                  type="text"
                  maxLength={24}
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '3px',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#090e17',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    fontSize: '11px',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Card Title / Subtitle
                <input
                  type="text"
                  maxLength={32}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '3px',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#090e17',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    fontSize: '11px',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <button
                type="button"
                disabled={saving}
                onClick={handleSavePrefs}
                style={{
                  marginTop: '2px',
                  padding: '6px',
                  borderRadius: '6px',
                  backgroundColor: '#0284c7',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Card Setup'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
