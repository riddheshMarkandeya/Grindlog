import React, { useState } from 'react';
import type { ShotMapItem } from '../../shared/types.ts';

interface ShotMapProps {
  shots: ShotMapItem[];
  attackingTeamNum?: number;
}

export const ShotMap: React.FC<ShotMapProps> = ({ shots }) => {
  const [hoveredShot, setHoveredShot] = useState<ShotMapItem | null>(null);

  // Rocket League arena pitch dimensions:
  // X spans -4096 to +4096 (width 8192)
  // Y spans -5120 to +5120 (length 10240)
  // We project top-down onto an SVG pitch
  const svgWidth = 600;
  const svgHeight = 750;
  const pad = 30;

  const mapX = (rlX: number) => pad + ((rlX + 4096) / 8192) * (svgWidth - pad * 2);
  const mapY = (rlY: number) => pad + ((-rlY + 5120) / 10240) * (svgHeight - pad * 2);

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'goal':
        return '#10b981'; // Green
      case 'saved':
        return '#38bdf8'; // Blue
      case 'woodwork':
        return '#fbbf24'; // Yellow
      case 'miss':
      default:
        return '#ef4444'; // Red
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#101726',
        borderRadius: '16px',
        padding: '24px',
        border: '1px solid #233252',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>2D Expected Goals (xG) Shot Map</h3>
          <p style={{ fontSize: '12px', color: '#64748b' }}>Bubble size represents xG quality; click or hover for telemetry</p>
        </div>
        <div style={{ display: 'flex', gap: '14px', fontSize: '12px', fontWeight: 600 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} /> Goal
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#38bdf8' }} /> Saved
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#fbbf24' }} /> Woodwork
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: '100%', maxWidth: '480px', height: 'auto', background: '#0a121c', borderRadius: '12px', border: '1px solid #1a2c42' }}
        >
          {/* Pitch boundary */}
          <rect x={pad} y={pad} width={svgWidth - pad * 2} height={svgHeight - pad * 2} fill="#0d1825" stroke="#1e3a5f" strokeWidth="2" rx="20" />

          {/* Goal mouths */}
          {/* Orange Goal Top (Y = +5120) */}
          <rect x={svgWidth / 2 - 50} y={pad - 12} width={100} height={12} fill="none" stroke="#fb923c" strokeWidth="3" />
          {/* Blue Goal Bottom (Y = -5120) */}
          <rect x={svgWidth / 2 - 50} y={svgHeight - pad} width={100} height={12} fill="none" stroke="#38bdf8" strokeWidth="3" />

          {/* Pitch markings */}
          <line x1={pad} y1={svgHeight / 2} x2={svgWidth - pad} y2={svgHeight / 2} stroke="#1e3a5f" strokeWidth="1.5" strokeDasharray="4 4" />
          <circle cx={svgWidth / 2} cy={svgHeight / 2} r="50" fill="none" stroke="#1e3a5f" strokeWidth="1.5" />
          <circle cx={svgWidth / 2} cy={svgHeight / 2} r="4" fill="#1e3a5f" />

          {/* Defensive boxes */}
          <rect x={svgWidth / 2 - 110} y={pad} width={220} height={120} fill="none" stroke="#1e3a5f" strokeWidth="1" strokeDasharray="2 2" />
          <rect x={svgWidth / 2 - 110} y={svgHeight - pad - 120} width={220} height={120} fill="none" stroke="#1e3a5f" strokeWidth="1" strokeDasharray="2 2" />

          {/* Shot Points */}
          {shots.map((shot, idx) => {
            const cx = mapX(shot.x);
            const cy = mapY(shot.y);
            // Size bubble proportional to xG (min 6px, max 26px)
            const r = Math.max(6, Math.min(26, shot.xg * 28));
            const color = getOutcomeColor(shot.outcome);

            return (
              <g
                key={shot.id || idx}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredShot(shot)}
                onMouseLeave={() => setHoveredShot(null)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={color}
                  fillOpacity="0.85"
                  stroke="#ffffff"
                  strokeWidth={shot.is_big_chance ? '2.5' : '1'}
                  style={{ transition: 'all 0.15s ease' }}
                />
                {shot.is_big_chance && (
                  <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.5" />
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoveredShot && (
          <div
            style={{
              position: 'absolute',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#172238',
              border: '1px solid #3b82f6',
              borderRadius: '10px',
              padding: '10px 16px',
              color: '#ffffff',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '14px' }}>{hoveredShot.player_name}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                Outcome: <strong style={{ color: getOutcomeColor(hoveredShot.outcome), textTransform: 'capitalize' }}>{hoveredShot.outcome}</strong>
              </div>
            </div>
            <div style={{ borderLeft: '1px solid #334155', paddingLeft: '12px', fontSize: '12px' }}>
              <div>xG: <strong style={{ color: '#10b981' }}>{hoveredShot.xg}</strong> {hoveredShot.is_big_chance && '★ Big Chance'}</div>
              <div style={{ color: '#94a3b8' }}>Speed: {hoveredShot.speed_kmh} km/h</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
