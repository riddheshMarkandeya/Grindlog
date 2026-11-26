import React, { useId, useState } from 'react';
import type { CarBodyType, FifaCardData } from '../../shared/types.ts';
import {
  exportSingleFifaCardPng,
  FIFA_SHIELD_INNER_PATH_D,
  FIFA_SHIELD_PATH_D,
  getFifaCardVisualSpec,
} from '../utils/fifa-card-canvas.ts';

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
  { id: 'fennec', label: 'Fennec' },
  { id: 'octane', label: 'Octane' },
  { id: 'dominus', label: 'Dominus' },
  { id: 'breakout', label: 'Breakout' },
  { id: 'hybrid', label: 'Hybrid' },
];

function getCarImageUrl(carBody: CarBodyType): string {
  const key = carBody === 'hybrid' ? 'fennec' : carBody;
  return `/cars/${key}.png`;
}

/**
 * Authentic EA FC / FIFA Ultimate Team Shield Card component with curved metallic bezel,
 * tier-specific artwork (Gold Rare, Obsidian-Gold TOTW, Sapphire-Gold TOTY, Pearl ICON),
 * isolated 3D Rocket League car renders, clean left metadata stack, and 15-game cycle lock controls below.
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
  const uid = useId().replace(/:/g, '');
  const [tilt, setTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [carDraft, setCarDraft] = useState<CarBodyType>(card.car_body);
  const [nameDraft, setNameDraft] = useState(card.display_name);
  const [titleDraft, setTitleDraft] = useState(card.card_title);

  const spec = getFifaCardVisualSpec(card);
  const isSmall = size === 'sm';
  const cardWidth = isSmall ? 236 : 296;
  const cardHeight = Math.round((cardWidth * 430) / 300);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: Math.round(-y * 9 * 10) / 10, ry: Math.round(x * 11 * 10) / 10 });
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

  const cycleTooltip = card.cycle.is_provisional
    ? `Provisional (${card.cycle.total_matches}/${card.cycle.cycle_size} matches) — 15-game lock starts at Match #${card.cycle.cycle_size}`
    : `Cycle #${card.cycle.current_cycle} (Matches #${card.cycle.window_start_match}–#${card.cycle.window_end_match}) · Locked for ${card.cycle.matches_until_refresh} more match${card.cycle.matches_until_refresh === 1 ? '' : 'es'}.`;

  const topPs = card.playstyles[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: `${cardWidth}px`, flexShrink: 0 }}>
      {/* Pure Curved FIFA Shield Face */}
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
        onClick={onClick}
        title={cycleTooltip}
        style={{
          width: `${cardWidth}px`,
          height: `${cardHeight}px`,
          position: 'relative',
          filter: `drop-shadow(0 18px 28px rgba(0, 0, 0, 0.72)) drop-shadow(0 0 18px ${spec.accentGlow}2b)`,
          transform: `perspective(950px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          transition: 'transform 0.14s ease-out',
          cursor: onClick ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <svg viewBox="0 0 300 430" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <clipPath id={`shield-clip-${uid}`}>
              <path d={FIFA_SHIELD_PATH_D} />
            </clipPath>
            <radialGradient id={`up-grad-${uid}`} cx="28%" cy="22%" r="72%">
              <stop offset="0%" stopColor={spec.bgUpper1} />
              <stop offset="100%" stopColor={spec.bgUpper2} />
            </radialGradient>
            <linearGradient id={`low-grad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={spec.bgLower1} />
              <stop offset="100%" stopColor={spec.bgLower2} />
            </linearGradient>
            <linearGradient id={`rim-grad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={spec.borderOuter} />
              <stop offset="50%" stopColor={spec.borderInner} />
              <stop offset="100%" stopColor={spec.borderOuter} />
            </linearGradient>
            <linearGradient id={`car-fade-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="86%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <mask id={`car-mask-${uid}`}>
              <rect x="0" y="0" width="300" height="250" fill={`url(#car-fade-${uid})`} />
            </mask>
          </defs>

          <g clipPath={`url(#shield-clip-${uid})`}>
            {/* Upper Portrait Canvas */}
            <rect x="0" y="0" width="300" height="252" fill={`url(#up-grad-${uid})`} />

            {/* Tier-Authentic Foil Artwork */}
            {spec.theme === 'TOTW' && (
              <g>
                <polygon points="84,250 198,10 232,10 128,250" fill={spec.rayColor} />
                <polygon points="134,250 272,34 292,68 178,250" fill={spec.rayColor2} />
                <polygon points="196,250 292,118 292,152 224,250" fill={spec.rayColor} />
              </g>
            )}
            {spec.theme === 'TOTY' && (
              <g>
                <path
                  d="M 85 0 Q 170 118 290 88 L 290 212 Q 150 170 10 242 L 10 135 Z"
                  fill={spec.rayColor2}
                />
                <polygon points="10,115 232,0 272,0 10,154" fill={spec.rayColor} />
              </g>
            )}
            {spec.theme !== 'TOTW' && spec.theme !== 'TOTY' && (
              <g>
                <polygon points="44,248 176,8 214,8 88,248" fill={spec.rayColor} />
                <polygon points="118,248 256,18 288,54 156,248" fill={spec.rayColor2} />
                <polygon points="184,248 288,110 288,144 208,248" fill={spec.rayColor} />
              </g>
            )}

            {/* Lower Stats Bed & Crisp Horizon Split */}
            <rect x="0" y="248" width="300" height="184" fill={`url(#low-grad-${uid})`} />
            <line x1="14" y1="248" x2="286" y2="248" stroke={spec.divider} strokeWidth="1.4" />

            {/* Top Center Crest Emblem for Special Cards */}
            {spec.topEmblem && (
              <text
                x="150"
                y="26"
                textAnchor="middle"
                fill={spec.textSub}
                fontSize="9.5"
                fontWeight="900"
                letterSpacing="1.8"
                fontFamily="system-ui, sans-serif"
              >
                {spec.topEmblem}
              </text>
            )}

            {/* Left Column Only: OVR -> POS -> Rule -> Mode -> Rule -> Club Crest (Top-Right Completely Clean!) */}
            <text
              x="56"
              y="84"
              textAnchor="middle"
              fill={spec.textMain}
              fontSize="45"
              fontWeight="900"
              letterSpacing="-1.5"
              fontFamily="system-ui, sans-serif"
            >
              {card.ovr}
            </text>
            <text
              x="56"
              y="105"
              textAnchor="middle"
              fill={spec.textSub}
              fontSize="16.5"
              fontWeight="800"
              letterSpacing="0.8"
              fontFamily="system-ui, sans-serif"
            >
              {card.position}
            </text>

            <line x1="38" y1="115" x2="74" y2="115" stroke={spec.divider} strokeWidth="1.2" />

            <text
              x="56"
              y="136"
              textAnchor="middle"
              fill={spec.textMain}
              fontSize="10.5"
              fontWeight="900"
              letterSpacing="0.8"
              fontFamily="system-ui, sans-serif"
            >
              RL 3v3
            </text>

            <line x1="38" y1="146" x2="74" y2="146" stroke={spec.divider} strokeWidth="1.2" />

            <circle cx="56" cy="172" r="14" fill="none" stroke={spec.textMain} strokeWidth="1.6" />
            <text
              x="56"
              y="175"
              textAnchor="middle"
              fill={spec.textMain}
              fontSize="8.5"
              fontWeight="900"
              letterSpacing="0.6"
              fontFamily="system-ui, sans-serif"
            >
              ORL
            </text>

            {/* Real 3D Rocket League Car Cutout PNG */}
            <image
              href={getCarImageUrl(card.car_body)}
              x="84"
              y="66"
              width="202"
              height="168"
              preserveAspectRatio="xMidYMid meet"
              mask={`url(#car-mask-${uid})`}
            />

            {/* Nameplate (Clean Bold Condensed Uppercase above Rule) */}
            <text
              x="150"
              y="282"
              textAnchor="middle"
              fill={spec.textMain}
              fontSize="24"
              fontWeight="900"
              letterSpacing="0.8"
              fontFamily="system-ui, sans-serif"
            >
              {card.display_name.toUpperCase().slice(0, 16)}
            </text>
            <line x1="40" y1="292" x2="260" y2="292" stroke={spec.divider} strokeWidth="1.2" />

            {/* Vertical Divider & 2x3 Stats */}
            <line x1="150" y1="304" x2="150" y2="382" stroke={spec.divider} strokeWidth="1.2" />

            {[
              { lVal: card.stats.pac, lLab: 'PAC', rVal: card.stats.dri, rLab: 'DRI', y: 322 },
              { lVal: card.stats.sho, lLab: 'SHO', rVal: card.stats.tac, rLab: 'TAC', y: 348 },
              { lVal: card.stats.pas, lLab: 'PAS', rVal: card.stats.gk, rLab: 'GK', y: 374 },
            ].map(row => (
              <g key={row.lLab}>
                <text x="88" y={row.y} textAnchor="end" fill={spec.textMain} fontSize="19" fontWeight="900" fontFamily="system-ui, sans-serif">
                  {row.lVal}
                </text>
                <text x="94" y={row.y} textAnchor="start" fill={spec.textSub} fontSize="15" fontWeight="600" fontFamily="system-ui, sans-serif">
                  {row.lLab}
                </text>
                <text x="198" y={row.y} textAnchor="end" fill={spec.textMain} fontSize="19" fontWeight="900" fontFamily="system-ui, sans-serif">
                  {row.rVal}
                </text>
                <text x="204" y={row.y} textAnchor="start" fill={spec.textSub} fontSize="15" fontWeight="600" fontFamily="system-ui, sans-serif">
                  {row.rLab}
                </text>
              </g>
            ))}

            {/* Minimal Bottom PlayStyle+ Emblem */}
            <line x1="114" y1="391" x2="186" y2="391" stroke={spec.divider} strokeWidth="1.1" />
            {topPs && (
              <text
                x="150"
                y="407"
                textAnchor="middle"
                fill={spec.textSub}
                fontSize="9.5"
                fontWeight="800"
                letterSpacing="0.8"
                fontFamily="system-ui, sans-serif"
              >
                {topPs.name.toUpperCase()}+
              </text>
            )}
          </g>

          {/* Double Metallic Foil Shield Rim */}
          <path d={FIFA_SHIELD_PATH_D} fill="none" stroke={`url(#rim-grad-${uid})`} strokeWidth="4.2" />
          <path d={FIFA_SHIELD_INNER_PATH_D} fill="none" stroke={spec.borderOuter} strokeOpacity="0.45" strokeWidth="1" />
        </svg>
      </div>

      {/* Companion Controls, 15-Game Lock Progress, AER/DIS & Share Outside Card */}
      {(showCycleBar || editable || showShare) && (
        <div className="surface-sub" style={{ width: '100%', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <span>AER {card.stats.aer} · DIS {card.stats.dis}</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 800 }}>{card.total800}/800 PWR</span>
          </div>

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
                    ? `${card.cycle.matches_until_refresh}G left`
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
                  {editing ? 'Close' : 'Edit Car / Name'}
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
                  {copied ? 'Copied PNG!' : 'Share Discord'}
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
                Rocket League Car
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
                Edition Subtitle
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
