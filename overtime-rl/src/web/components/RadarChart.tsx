import React, { useState } from 'react';
import type { RadarProfile } from '../../shared/types.ts';
import { OvrBadge } from './OvrBadge.tsx';

export const ATTRIBUTE_DESCRIPTIONS: Record<string, string> = {
  Finishing: 'Shot conversion efficiency, clinical finishing, and scoring goals relative to expected goals (xG).',
  Creation: 'Playmaking vision, key passes, assist delivery, and setting up high-probability scoring chances.',
  Dribbling: 'Sustained forward multi-touch ball carries, beating challengers cleanly, and solo dribble finishes.',
  Pace: 'Net-to-net ball transition speed, rapid counter-attack goals, and sustained supersonic rotation tempo.',
  Tackling: 'Outfield 50/50 duel wins, clean dribble dispossessions, shadow defense delays, and physical disruptions.',
  Goalkeeping: 'Difficulty-weighted xG prevented on net, reflex saves, safe corner clears, and avoiding spilled rebounds.',
  Aerial: 'High-altitude aerial touches, fast aerial saves, air dribbles, and backboard aerial clears.',
  Discipline: 'Clean rotational spacing, 3rd-man safety covers, low double commits, and boost/pad discipline.',
};

interface RadarChartProps {
  radar: RadarProfile;
  playerName?: string;
  size?: number;
}

export const RadarChart: React.FC<RadarChartProps> = ({
  radar,
  playerName,
  size = 320,
}) => {
  const [hoveredAxis, setHoveredAxis] = useState<{ label: string; value: number } | null>(null);

  const handleAxisHover = (axis: { label: string; value: number }) => {
    setHoveredAxis(axis);
  };

  const center = size / 2;
  const radius = size * 0.28;

  const axes = [
    { label: 'Finishing', value: radar.finishing },
    { label: 'Creation', value: radar.creation },
    { label: 'Dribbling', value: radar.dribbling },
    { label: 'Pace', value: radar.pace },
    { label: 'Tackling', value: radar.tackling },
    { label: 'Goalkeeping', value: radar.goalkeeping },
    ...(radar.aerial !== undefined ? [{ label: 'Aerial', value: radar.aerial }] : []),
    ...(radar.positioning !== undefined ? [{ label: 'Discipline', value: radar.positioning }] : []),
  ];

  const angleStep = (Math.PI * 2) / axes.length;

  // Grid levels (20%, 40%, 60%, 80%, 100%)
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];

  const getCoord = (index: number, valNorm: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const r = valNorm * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      angle,
    };
  };

  const polygonPoints = axes
    .map((axis, i) => {
      const { x, y } = getCoord(i, axis.value / 100);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div
      className="surface-card"
      style={{
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: `${size + 40}px`,
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: '14px', gap: '8px' }}>
        <div>
          {playerName && <h4 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{playerName}</h4>}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{axes.length}-Axis Tactical Radar</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
              height: 'fit-content',
            }}
          >
            {radar.archetype}
          </span>
          <OvrBadge radar={radar} />
        </div>
      </div>

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', maxWidth: '100%' }}>
        {/* Hexagon Grids */}
        {levels.map((lvl, lIdx) => {
          const gridPoints = axes
            .map((_, i) => {
              const { x, y } = getCoord(i, lvl);
              return `${x},${y}`;
            })
            .join(' ');
          return (
            <polygon
              key={lIdx}
              points={gridPoints}
              fill={lIdx === levels.length - 1 ? 'var(--bg-inset)' : 'none'}
              stroke="var(--border-hairline)"
              strokeWidth="1"
            />
          );
        })}

        {/* Axis Lines */}
        {axes.map((_, i) => {
          const { x, y } = getCoord(i, 1.0);
          return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="var(--border-hairline)" strokeWidth="1" />;
        })}

        {/* Tactical Profile Polygon */}
        <polygon
          points={polygonPoints}
          fill="var(--accent-cyan-soft)"
          stroke="var(--accent-cyan)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Axis Points */}
        {axes.map((axis, i) => {
          const { x, y } = getCoord(i, axis.value / 100);
          const isHovered = hoveredAxis?.label === axis.label;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isHovered ? 6 : 4}
              fill={isHovered ? '#ffffff' : 'var(--accent-cyan)'}
              stroke={isHovered ? 'var(--accent-cyan)' : '#ffffff'}
              strokeWidth={isHovered ? 2.5 : 1.5}
              style={{ transition: 'all 0.15s ease', cursor: 'pointer' }}
              onMouseEnter={() => handleAxisHover(axis)}
              onMouseLeave={() => setHoveredAxis(null)}
            />
          );
        })}

        {/* Axis Labels with Directional Anchoring to prevent clipping */}
        {axes.map((axis, i) => {
          const { x, y, angle } = getCoord(i, 1.0);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const isHovered = hoveredAxis?.label === axis.label;

          let anchor: 'start' | 'middle' | 'end' = 'middle';
          let baseline: 'auto' | 'middle' | 'hanging' = 'middle';
          let offsetX = 0;
          let offsetY = 0;

          if (cos > 0.25) {
            anchor = 'start';
            offsetX = 10;
          } else if (cos < -0.25) {
            anchor = 'end';
            offsetX = -10;
          }

          if (sin < -0.7) {
            baseline = 'auto';
            offsetY = -8;
          } else if (sin > 0.7) {
            baseline = 'hanging';
            offsetY = 8;
          }

          return (
            <g
              key={i}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => handleAxisHover(axis)}
              onMouseLeave={() => setHoveredAxis(null)}
            >
              <title>{`${axis.label} (${axis.value}/100): ${ATTRIBUTE_DESCRIPTIONS[axis.label] || ''}`}</title>
              <text
                x={x + offsetX}
                y={y + offsetY}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fill={isHovered ? 'var(--accent-cyan)' : 'var(--text-secondary)'}
                fontSize="11"
                fontWeight={isHovered ? '800' : '700'}
                style={{ transition: 'fill 0.15s ease' }}
              >
                {axis.label} ({axis.value})
              </text>
            </g>
          );
        })}
      </svg>

      {/* Single-line Attribute Educational Info Card */}
      {hoveredAxis && (
        <div
          className="surface-card-elevated"
          style={{
            marginTop: '14px',
            width: '100%',
            padding: '10px 14px',
            borderColor: 'var(--accent-cyan)',
            fontSize: '11px',
            lineHeight: '1.4',
            color: 'var(--text-primary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>ℹ️</span> {hoveredAxis.label} ({hoveredAxis.value}/100)
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {ATTRIBUTE_DESCRIPTIONS[hoveredAxis.label] || 'Tactical performance metric evaluated by the OvertimeRL engine.'}
          </div>
        </div>
      )}
    </div>
  );
};

interface DualRadarChartProps {
  playerA: { name: string; radar: RadarProfile; teamLabel?: string };
  playerB: { name: string; radar: RadarProfile; teamLabel?: string };
  size?: number;
}

export const DualRadarChart: React.FC<DualRadarChartProps> = ({
  playerA,
  playerB,
  size = 360,
}) => {
  const center = size / 2;
  const radius = size * 0.28;
  const axes = [
    { label: 'Finishing', a: playerA.radar.finishing, b: playerB.radar.finishing },
    { label: 'Creation', a: playerA.radar.creation, b: playerB.radar.creation },
    { label: 'Dribbling', a: playerA.radar.dribbling, b: playerB.radar.dribbling },
    { label: 'Pace', a: playerA.radar.pace, b: playerB.radar.pace },
    { label: 'Tackling', a: playerA.radar.tackling, b: playerB.radar.tackling },
    { label: 'Goalkeeping', a: playerA.radar.goalkeeping, b: playerB.radar.goalkeeping },
    ...(playerA.radar.aerial !== undefined && playerB.radar.aerial !== undefined
      ? [{ label: 'Aerial', a: playerA.radar.aerial, b: playerB.radar.aerial }]
      : []),
    ...(playerA.radar.positioning !== undefined && playerB.radar.positioning !== undefined
      ? [{ label: 'Discipline', a: playerA.radar.positioning, b: playerB.radar.positioning }]
      : []),
  ];

  const angleStep = (Math.PI * 2) / axes.length;
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const getCoord = (index: number, valNorm: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const r = valNorm * radius;
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle), angle };
  };

  const polyA = axes.map((ax, i) => {
    const { x, y } = getCoord(i, ax.a / 100);
    return `${x},${y}`;
  }).join(' ');

  const polyB = axes.map((ax, i) => {
    const { x, y } = getCoord(i, ax.b / 100);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', maxWidth: '100%' }}>
          {levels.map((lvl, lIdx) => {
            const pts = axes.map((_, i) => {
              const { x, y } = getCoord(i, lvl);
              return `${x},${y}`;
            }).join(' ');
            return (
              <polygon
                key={lIdx}
                points={pts}
                fill={lIdx === levels.length - 1 ? 'var(--bg-inset)' : 'none'}
                stroke="var(--border-hairline)"
                strokeWidth="1"
              />
            );
          })}
          {axes.map((_, i) => {
            const { x, y } = getCoord(i, 1.0);
            return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="var(--border-hairline)" strokeWidth="1" />;
          })}

          <polygon points={polyB} fill="rgba(251, 146, 60, 0.22)" stroke="#fb923c" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points={polyA} fill="rgba(56, 189, 248, 0.26)" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />

          {axes.map((ax, i) => {
            const pA = getCoord(i, ax.a / 100);
            const pB = getCoord(i, ax.b / 100);
            const lbl = getCoord(i, 1.0);
            const cos = Math.cos(lbl.angle);
            const sin = Math.sin(lbl.angle);
            const anchor: 'start' | 'middle' | 'end' = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
            const baseline: 'auto' | 'middle' | 'hanging' = sin < -0.7 ? 'auto' : sin > 0.7 ? 'hanging' : 'middle';
            const offsetX = cos > 0.25 ? 10 : cos < -0.25 ? -10 : 0;
            const offsetY = sin < -0.7 ? -8 : sin > 0.7 ? 8 : 0;
            return (
              <g key={ax.label}>
                <circle cx={pB.x} cy={pB.y} r="3.5" fill="#fb923c" stroke="#ffffff" strokeWidth="1" />
                <circle cx={pA.x} cy={pA.y} r="4" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.2" />
                <text
                  x={lbl.x + offsetX}
                  y={lbl.y + offsetY}
                  textAnchor={anchor}
                  dominantBaseline={baseline}
                  fill="var(--text-secondary)"
                  fontSize="11"
                  fontWeight="700"
                >
                  {ax.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Head-to-Head Delta Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8' }}>
              ● {playerA.name} ({playerA.radar.archetype})
            </span>
            <OvrBadge radar={playerA.radar} />
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>VS</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#fb923c' }}>
              ● {playerB.name} ({playerB.radar.archetype})
            </span>
            <OvrBadge radar={playerB.radar} />
          </div>
        </div>

        {axes.map(ax => {
          const diff = ax.a - ax.b;
          return (
            <div key={ax.label} className="surface-sub" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ fontWeight: 800, color: ax.a >= ax.b ? '#38bdf8' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{ax.a}</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {ax.label}{' '}
                  <span style={{ fontSize: '10px', color: diff > 0 ? '#38bdf8' : diff < 0 ? '#fb923c' : 'var(--text-muted)' }}>
                    ({diff > 0 ? `+${diff}` : diff})
                  </span>
                </span>
                <span style={{ fontWeight: 800, color: ax.b > ax.a ? '#fb923c' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{ax.b}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', height: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-inset)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${ax.a}%`, backgroundColor: '#38bdf8', borderRadius: '3px' }} />
                </div>
                <div style={{ backgroundColor: 'var(--bg-inset)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${ax.b}%`, backgroundColor: '#fb923c', borderRadius: '3px', height: '100%' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
