import React from 'react';
import type { MomentumPoint, DoubleCommitEvent } from '../../shared/types.ts';

interface MomentumGraphProps {
  points: MomentumPoint[];
  team0Name?: string;
  team1Name?: string;
  isUserOnTeam0?: boolean;
  isUserOnTeam1?: boolean;
  doubleCommits?: DoubleCommitEvent[];
  activeTimeSec?: number | null;
  onSelectTimeSec?: (timeSec: number) => void;
}

export const MomentumGraph: React.FC<MomentumGraphProps> = ({
  points,
  isUserOnTeam0 = false,
  isUserOnTeam1 = false,
  doubleCommits = [],
  activeTimeSec = null,
  onSelectTimeSec,
}) => {
  if (!points || points.length === 0) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>No momentum telemetry available.</div>;
  }

  const width = 800;
  const height = 165;
  const midY = height / 2;
  const paddingX = 36;
  const plotWidth = width - paddingX * 2;

  const maxInterval = points.length - 1;
  const maxTimeSec = Math.max(300, points[maxInterval]?.time_seconds || maxInterval * 10);
  const getX = (idx: number) => paddingX + (idx / Math.max(1, maxInterval)) * plotWidth;
  const getXForTime = (sec: number) => paddingX + Math.min(1, Math.max(0, sec / maxTimeSec)) * plotWidth;
  const getY = (m: number) => midY - (m / 100) * (height / 2 - 18);

  const pointsCoords = points.map((p, i) => ({ x: getX(i), y: getY(p.momentum), m: p.momentum }));

  const posPath = [
    `M ${paddingX} ${midY}`,
    ...pointsCoords.map(p => `L ${p.x} ${p.m >= 0 ? p.y : midY}`),
    `L ${getX(maxInterval)} ${midY}`,
    'Z',
  ].join(' ');

  const negPath = [
    `M ${paddingX} ${midY}`,
    ...pointsCoords.map(p => `L ${p.x} ${p.m <= 0 ? p.y : midY}`),
    `L ${getX(maxInterval)} ${midY}`,
    'Z',
  ].join(' ');

  const linePath = pointsCoords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="surface-card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>Momentum Pressure Wave</span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-sub)',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {onSelectTimeSec ? 'Click wave or pins to sync Pitch' : '10s Ticks'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '14px', fontSize: '12px', fontWeight: 700, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--team0-blue)' }}>
            ▲ {isUserOnTeam0 ? 'YOUR TEAM (Blue)' : isUserOnTeam1 ? 'OPPONENTS (Blue)' : 'Blue Team'}
            <span
              style={{
                fontSize: '9px',
                fontWeight: 900,
                backgroundColor: isUserOnTeam0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: isUserOnTeam0 ? '#34d399' : 'var(--text-muted)',
                padding: '1px 6px',
                borderRadius: '4px',
                border: isUserOnTeam0 ? '1px solid #10b981' : '1px solid var(--border-hairline)',
              }}
            >
              {isUserOnTeam0 ? '★ YOU' : isUserOnTeam1 ? 'OPPONENT' : 'BLUE'}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--team1-orange)' }}>
            ▼ {isUserOnTeam1 ? 'YOUR TEAM (Orange)' : isUserOnTeam0 ? 'OPPONENTS (Orange)' : 'Orange Team'}
            <span
              style={{
                fontSize: '9px',
                fontWeight: 900,
                backgroundColor: isUserOnTeam1 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: isUserOnTeam1 ? '#34d399' : 'var(--text-muted)',
                padding: '1px 6px',
                borderRadius: '4px',
                border: isUserOnTeam1 ? '1px solid #10b981' : '1px solid var(--border-hairline)',
              }}
            >
              {isUserOnTeam1 ? '★ YOU' : isUserOnTeam0 ? 'OPPONENT' : 'ORANGE'}
            </span>
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: onSelectTimeSec ? 'pointer' : 'default' }}
          onClick={e => {
            if (!onSelectTimeSec) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * width;
            const norm = Math.min(1, Math.max(0, (svgX - paddingX) / plotWidth));
            onSelectTimeSec(Math.round(norm * maxTimeSec));
          }}
        >
          <defs>
            <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="orangeGradient" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#fb923c" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#fb923c" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <line x1={paddingX} y1={midY} x2={width - paddingX} y2={midY} stroke="#334155" strokeDasharray="3 3" strokeWidth="1" />
          <line x1={paddingX} y1={midY - 36} x2={width - paddingX} y2={midY - 36} stroke="rgba(148,163,184,0.1)" strokeWidth="1" />
          <line x1={paddingX} y1={midY + 36} x2={width - paddingX} y2={midY + 36} stroke="rgba(148,163,184,0.1)" strokeWidth="1" />

          <path d={posPath} fill="url(#blueGradient)" />
          <path d={negPath} fill="url(#orangeGradient)" />
          <path d={linePath} fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinejoin="round" />

          {/* Synced Playhead Line */}
          {activeTimeSec !== null && activeTimeSec >= 0 && (
            <g>
              <line
                x1={getXForTime(activeTimeSec)}
                y1={8}
                x2={getXForTime(activeTimeSec)}
                y2={height - 8}
                stroke="var(--accent-cyan)"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
              <circle cx={getXForTime(activeTimeSec)} cy={10} r="4" fill="var(--accent-cyan)" stroke="#ffffff" strokeWidth="1.5" />
            </g>
          )}

          {/* Event Pins */}
          {points.flatMap((p, i) =>
            p.events.map((ev, eIdx) => {
              const x = getX(i);
              const y = getY(p.momentum);
              const icon = ev.type === 'goal' ? '⚽' : ev.type === 'save' ? '🧤' : ev.type === 'woodwork' ? '🥅' : '💥';
              return (
                <g
                  key={`${i}-${eIdx}`}
                  transform={`translate(${x}, ${y})`}
                  onClick={evt => {
                    if (!onSelectTimeSec) return;
                    evt.stopPropagation();
                    onSelectTimeSec(p.time_seconds);
                  }}
                >
                  <circle r="10.5" fill="var(--bg-inset)" stroke={ev.team === 0 ? '#38bdf8' : '#fb923c'} strokeWidth="1.5" />
                  <text y="3.5" textAnchor="middle" fontSize="10">
                    {icon}
                  </text>
                  <title>{ev.text}</title>
                </g>
              );
            })
          )}

          {/* Double Commit Pins */}
          {doubleCommits.map((dc, dcIdx) => {
            const x = getXForTime(dc.time_seconds);
            const y = dc.team_num === 0 ? midY - 26 : midY + 26;
            const color = dc.is_fatal || dc.net_status === 'rusher_open_net' ? '#ef4444' : dc.net_status === 'covered' ? '#38bdf8' : '#eab308';
            return (
              <g
                key={`dc-${dcIdx}`}
                transform={`translate(${x}, ${y})`}
                onClick={evt => {
                  if (!onSelectTimeSec) return;
                  evt.stopPropagation();
                  onSelectTimeSec(dc.time_seconds);
                }}
              >
                <circle r="9.5" fill="#161412" stroke={color} strokeWidth={dc.is_fatal ? '2' : '1.4'} />
                <text y="3" textAnchor="middle" fontSize="8.5">
                  {dc.net_status === 'covered' ? '🛡️' : '⚠️'}
                </text>
                <title>
                  {`[${Math.floor(dc.time_seconds / 60)}:${(dc.time_seconds % 60).toString().padStart(2, '0')}] ${dc.player1_name} & ${dc.player2_name}${dc.context_reason ? ` — ${dc.context_reason}` : ''}`}
                </title>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span>00:00</span>
        <span>Mid-Game</span>
        <span>{`${Math.floor(maxTimeSec / 60).toString().padStart(2, '0')}:${Math.round(maxTimeSec % 60).toString().padStart(2, '0')}`}</span>
      </div>
    </div>
  );
};
