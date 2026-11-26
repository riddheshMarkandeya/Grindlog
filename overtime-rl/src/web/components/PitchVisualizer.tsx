import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { ShotMapItem, DoubleCommitEvent, MatchPlayerAnalysis, PlayTrailPoint } from '../../shared/types.ts';
import { TimelineScrubber } from './TimelineScrubber.tsx';

interface PitchVisualizerProps {
  shots: ShotMapItem[];
  doubleCommits: DoubleCommitEvent[];
  players?: MatchPlayerAnalysis[];
  matchDurationSec?: number;
  activeTimeSec?: number | null;
  onActiveTimeChange?: (timeSec: number | null) => void;
  onInspectPlayer?: (player: MatchPlayerAnalysis) => void;
}

type EventType = 'shot' | 'double_commit';

interface UnifiedEvent {
  id: string;
  type: EventType;
  timeSec: number;
  x: number;
  y: number;
  z?: number;
  player1: string;
  player2?: string;
  teamNum: number;
  isFatal?: boolean;
  outcome?: string;
  xg?: number;
  speedKmh?: number;
  distance?: number;
  isBigChance?: boolean;
  carrierName?: string;
  intruderName?: string;
  carrierX?: number;
  carrierY?: number;
  intruderX?: number;
  intruderY?: number;
  netStatus?: string;
  trail?: PlayTrailPoint[];
  rawShot?: ShotMapItem;
  rawDC?: DoubleCommitEvent;
}

const BIG_BOOST_PADS = [
  { id: 'b_bl', x: -3072, y: -4096 },
  { id: 'b_br', x: 3072, y: -4096 },
  { id: 'b_ml', x: -3584, y: 0 },
  { id: 'b_mr', x: 3584, y: 0 },
  { id: 'b_ol', x: -3072, y: 4096 },
  { id: 'b_or', x: 3072, y: 4096 },
];

const SMALL_PADS = [
  { x: 0, y: 0 }, { x: -1024, y: 0 }, { x: 1024, y: 0 }, { x: -2048, y: 0 }, { x: 2048, y: 0 },
  { x: 0, y: -2816 }, { x: -1024, y: -2048 }, { x: 1024, y: -2048 }, { x: 0, y: -4600 }, { x: -1280, y: -4100 }, { x: 1280, y: -4100 },
  { x: 0, y: 2816 }, { x: -1024, y: 2048 }, { x: 1024, y: 2048 }, { x: 0, y: 4600 }, { x: -1280, y: 4100 }, { x: 1280, y: 4100 },
];

const formatClock = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const PitchVisualizer: React.FC<PitchVisualizerProps> = ({
  shots,
  doubleCommits,
  players = [],
  matchDurationSec = 300,
  activeTimeSec = null,
  onActiveTimeChange,
  onInspectPlayer,
}) => {
  const [filter, setFilter] = useState<'all' | 'shots' | 'goals' | 'double_commits' | 'fatal'>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const svgWidth = 640;
  const svgHeight = 760;
  const pad = 34;

  const mapX = (rlX: number) => pad + ((rlX + 4096) / 8192) * (svgWidth - pad * 2);
  const mapY = (rlY: number) => pad + ((-rlY + 5120) / 10240) * (svgHeight - pad * 2);

  const unifiedEvents: UnifiedEvent[] = useMemo(() => {
    const list: UnifiedEvent[] = [];

    shots.forEach((s, idx) => {
      list.push({
        id: `shot-${s.id || idx}`,
        type: 'shot',
        timeSec: s.time_seconds,
        x: s.x,
        y: s.y,
        z: s.z,
        player1: s.player_name,
        teamNum: s.team_num,
        outcome: s.outcome,
        xg: s.xg,
        speedKmh: s.speed_kmh,
        distance: s.distance,
        isBigChance: s.is_big_chance,
        trail: s.trail,
        rawShot: s,
      });
    });

    doubleCommits.forEach((dc, idx) => {
      list.push({
        id: `dc-${idx}`,
        type: 'double_commit',
        timeSec: dc.time_seconds,
        x: dc.x ?? dc.intruder_x ?? 0,
        y: dc.y ?? dc.intruder_y ?? 0,
        z: dc.z ?? 0,
        player1: dc.player1_name,
        player2: dc.player2_name,
        teamNum: dc.team_num,
        isFatal: dc.is_fatal,
        carrierName: dc.carrier_name,
        intruderName: dc.instigator_name,
        carrierX: dc.carrier_x ?? dc.x,
        carrierY: dc.carrier_y ?? dc.y,
        intruderX: dc.intruder_x ?? dc.x,
        intruderY: dc.intruder_y ?? dc.y,
        netStatus: dc.net_status,
        trail: dc.trail,
        rawDC: dc,
      });
    });

    return list.sort((a, b) => a.timeSec - b.timeSec);
  }, [shots, doubleCommits]);

  const filteredEvents = useMemo(() => {
    return unifiedEvents.filter(e => {
      if (filter === 'shots') return e.type === 'shot';
      if (filter === 'goals') return e.type === 'shot' && e.outcome === 'goal';
      if (filter === 'double_commits') return e.type === 'double_commit';
      if (filter === 'fatal') return e.type === 'double_commit' && (e.isFatal || e.netStatus === 'rusher_open_net');
      return true;
    });
  }, [unifiedEvents, filter]);

  const selectedEvent = useMemo(() => {
    if (selectedEventId) {
      return unifiedEvents.find(e => e.id === selectedEventId) || filteredEvents[0] || null;
    }
    return filteredEvents[0] || null;
  }, [selectedEventId, unifiedEvents, filteredEvents]);

  // Sync external MomentumGraph clicks into closest event
  useEffect(() => {
    if (activeTimeSec === null || filteredEvents.length === 0) return;
    if (selectedEvent && Math.abs(selectedEvent.timeSec - activeTimeSec) <= 1) return;
    let closest = filteredEvents[0];
    let minDiff = Math.abs(filteredEvents[0].timeSec - activeTimeSec);
    for (const ev of filteredEvents) {
      const diff = Math.abs(ev.timeSec - activeTimeSec);
      if (diff < minDiff) {
        minDiff = diff;
        closest = ev;
      }
    }
    if (closest) setSelectedEventId(closest.id);
  }, [activeTimeSec, filteredEvents]);

  const selectEvent = useCallback(
    (id: string) => {
      setSelectedEventId(id);
      const found = unifiedEvents.find(e => e.id === id);
      if (found && onActiveTimeChange) {
        onActiveTimeChange(found.timeSec);
      }
    },
    [unifiedEvents, onActiveTimeChange]
  );

  const handlePrev = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const currIdx = filteredEvents.findIndex(e => e.id === (selectedEvent?.id || selectedEventId));
    const nextIdx = currIdx <= 0 ? filteredEvents.length - 1 : currIdx - 1;
    selectEvent(filteredEvents[nextIdx].id);
  }, [filteredEvents, selectedEvent, selectedEventId, selectEvent]);

  const handleNext = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const currIdx = filteredEvents.findIndex(e => e.id === (selectedEvent?.id || selectedEventId));
    const nextIdx = currIdx < 0 || currIdx >= filteredEvents.length - 1 ? 0 : currIdx + 1;
    selectEvent(filteredEvents[nextIdx].id);
  }, [filteredEvents, selectedEvent, selectedEventId, selectEvent]);

  // Auto-playback interval
  useEffect(() => {
    if (!isPlaying || filteredEvents.length === 0) return;
    const timer = window.setInterval(() => {
      handleNext();
    }, 2200);
    return () => window.clearInterval(timer);
  }, [isPlaying, filteredEvents.length, handleNext]);

  // Keyboard shortcuts for Pitch Scrubber (Left / Right / Space)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        handleNext();
      } else if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrev, handleNext]);

  const maxDuration = Math.max(
    matchDurationSec,
    unifiedEvents.reduce((m, e) => Math.max(m, e.timeSec), 300)
  );

  const findPlayerObj = (name?: string) =>
    name ? players.find(p => p.name.toLowerCase() === name.toLowerCase()) : undefined;

  const hasWoodwork = filteredEvents.some(e => e.outcome === 'woodwork');
  const hasMiss = filteredEvents.some(e => e.outcome === 'miss');
  const hasCovered = filteredEvents.some(e => e.netStatus === 'covered');

  return (
    <div className="surface-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Header & Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px' }}>🗺️</span>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              2D Pitch, xG Map & Play Scrubber
            </h3>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
                backgroundColor: 'var(--accent-cyan-soft)',
                color: 'var(--accent-cyan)',
                border: '1px solid var(--border-hairline)',
              }}
            >
              8192 × 10240 uu
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Drag the timeline slider or click any event on the pitch or Momentum Wave to trace preceding 3.5s buildup paths.
          </p>
        </div>

        {/* Filter Pills */}
        <div
          className="surface-sub"
          style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '10px', flexWrap: 'wrap' }}
        >
          {[
            { id: 'all', label: `All (${unifiedEvents.length})` },
            { id: 'shots', label: `Shots & xG (${shots.length})` },
            { id: 'goals', label: `Goals (${shots.filter(s => s.outcome === 'goal').length})` },
            { id: 'double_commits', label: `Overlaps (${doubleCommits.length})` },
            { id: 'fatal', label: `High Risk (${doubleCommits.filter(dc => dc.is_fatal || dc.net_status === 'rusher_open_net').length})` },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              style={{
                backgroundColor: filter === f.id ? 'var(--accent-cyan-soft)' : 'transparent',
                color: filter === f.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                border: 'none',
                padding: '6px 11px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Timeline Slider Right Below Header for Instant Access */}
      <TimelineScrubber
        events={filteredEvents}
        maxDuration={maxDuration}
        selectedEventId={selectedEvent?.id || null}
        onSelectEvent={id => {
          setIsPlaying(false);
          selectEvent(id);
        }}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(p => !p)}
        onPrev={() => {
          setIsPlaying(false);
          handlePrev();
        }}
        onNext={() => {
          setIsPlaying(false);
          handleNext();
        }}
      />

      {/* Main Pitch & Inspector Split */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.15fr) minmax(280px, 0.85fr)', gap: '20px', alignItems: 'start' }}>
        {/* SVG Pitch Canvas */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{
              width: '100%',
              maxWidth: '500px',
              height: 'auto',
              background: 'radial-gradient(ellipse at center, #0e1726 0%, #070b14 100%)',
              borderRadius: '16px',
              border: '1px solid var(--border-hairline)',
              boxShadow: 'inset 0 0 60px rgba(0, 0, 0, 0.65)',
            }}
          >
            <defs>
              <linearGradient id="goalOrange" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#fb923c" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#fb923c" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="goalBlue" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            <path
              d={`
                M ${pad + 40} ${pad}
                L ${svgWidth - pad - 40} ${pad}
                L ${svgWidth - pad} ${pad + 40}
                L ${svgWidth - pad} ${svgHeight - pad - 40}
                L ${svgWidth - pad - 40} ${svgHeight - pad}
                L ${pad + 40} ${svgHeight - pad}
                L ${pad} ${svgHeight - pad - 40}
                L ${pad} ${pad + 40}
                Z
              `}
              fill="#0b1320"
              stroke="#1e3a5f"
              strokeWidth="2.5"
            />

            <rect x={svgWidth / 2 - 65} y={pad - 18} width={130} height={18} fill="url(#goalOrange)" stroke="#fb923c" strokeWidth="3" rx="4" />
            <rect x={svgWidth / 2 - 65} y={svgHeight - pad} width={130} height={18} fill="url(#goalBlue)" stroke="#38bdf8" strokeWidth="3" rx="4" />

            <line x1={pad} y1={svgHeight / 2} x2={svgWidth - pad} y2={svgHeight / 2} stroke="#1e3a5f" strokeWidth="1.5" strokeDasharray="6 4" />
            <circle cx={svgWidth / 2} cy={svgHeight / 2} r="54" fill="none" stroke="#1e3a5f" strokeWidth="1.5" />
            <circle cx={svgWidth / 2} cy={svgHeight / 2} r="5" fill="#38bdf8" fillOpacity="0.7" />

            <rect x={svgWidth / 2 - 120} y={pad} width={240} height={130} fill="none" stroke="#1a2d47" strokeWidth="1" strokeDasharray="3 3" rx="8" />
            <rect x={svgWidth / 2 - 120} y={svgHeight - pad - 130} width={240} height={130} fill="none" stroke="#1a2d47" strokeWidth="1" strokeDasharray="3 3" rx="8" />

            {SMALL_PADS.map((p, idx) => (
              <circle key={`sp-${idx}`} cx={mapX(p.x)} cy={mapY(p.y)} r="3" fill="#334155" stroke="#64748b" strokeWidth="0.5" fillOpacity="0.55" />
            ))}

            {BIG_BOOST_PADS.map(b => (
              <g key={b.id}>
                <circle cx={mapX(b.x)} cy={mapY(b.y)} r="7.5" fill="#f59e0b" fillOpacity="0.2" stroke="#fbbf24" strokeWidth="1.3" />
                <circle cx={mapX(b.x)} cy={mapY(b.y)} r="3" fill="#fbbf24" />
              </g>
            ))}

            {/* Preceding 3.5s Ball & Possession Buildup Trail */}
            {selectedEvent?.trail && selectedEvent.trail.length >= 2 && (
              <g>
                <polyline
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.7)"
                  strokeWidth="2.2"
                  strokeDasharray="5 4"
                  points={selectedEvent.trail.map(t => `${mapX(t.x)},${mapY(t.y)}`).join(' ')}
                />
                {selectedEvent.trail.map((pt, tidx) => {
                  const isLast = tidx === selectedEvent.trail!.length - 1;
                  const ptColor = pt.team_num === 0 ? '#38bdf8' : '#fb923c';
                  return (
                    <g key={`tr-${tidx}`}>
                      <circle
                        cx={mapX(pt.x)}
                        cy={mapY(pt.y)}
                        r={isLast ? 5.5 : 4}
                        fill={ptColor}
                        fillOpacity={0.35 + (tidx / selectedEvent.trail!.length) * 0.6}
                        stroke="#ffffff"
                        strokeWidth="1"
                      />
                      <text
                        x={mapX(pt.x)}
                        y={mapY(pt.y) - 8}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="700"
                        fill="#cbd5e1"
                      >
                        {pt.player_name.slice(0, 8)} ({pt.ts_offset_sec}s)
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Tactical Vector Line for Selected Double Commit */}
            {selectedEvent?.type === 'double_commit' && selectedEvent.carrierX !== undefined && selectedEvent.intruderX !== undefined && (
              <g>
                <line
                  x1={mapX(selectedEvent.carrierX)}
                  y1={mapY(selectedEvent.carrierY ?? 0)}
                  x2={mapX(selectedEvent.intruderX)}
                  y2={mapY(selectedEvent.intruderY ?? 0)}
                  stroke={selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net' ? '#ef4444' : selectedEvent.netStatus === 'covered' ? '#38bdf8' : '#f59e0b'}
                  strokeWidth="3"
                  strokeDasharray="4 2"
                  filter="url(#glow)"
                />
                <circle cx={mapX(selectedEvent.carrierX)} cy={mapY(selectedEvent.carrierY ?? 0)} r="14" fill="none" stroke="#10b981" strokeWidth="2" />
                <circle
                  cx={mapX(selectedEvent.intruderX)}
                  cy={mapY(selectedEvent.intruderY ?? 0)}
                  r="16"
                  fill="none"
                  stroke={selectedEvent.isFatal ? '#ef4444' : '#f97316'}
                  strokeWidth="2.5"
                  strokeDasharray="2 2"
                />
              </g>
            )}

            {/* Tactical Shot Trajectory */}
            {selectedEvent?.type === 'shot' && (
              <line
                x1={mapX(selectedEvent.x)}
                y1={mapY(selectedEvent.y)}
                x2={svgWidth / 2}
                y2={selectedEvent.teamNum === 0 ? pad : svgHeight - pad}
                stroke={selectedEvent.outcome === 'goal' ? '#10b981' : '#38bdf8'}
                strokeWidth="2.2"
                strokeDasharray="3 3"
                opacity="0.85"
              />
            )}

            {/* Event Pins */}
            {filteredEvents.map(e => {
              const cx = mapX(e.x);
              const cy = mapY(e.y);
              const isSelected = e.id === selectedEvent?.id;

              if (e.type === 'shot') {
                const r = Math.max(6, Math.min(20, (e.xg ?? 0.2) * 24));
                const color = e.outcome === 'goal' ? '#10b981' : e.outcome === 'saved' ? '#38bdf8' : e.outcome === 'woodwork' ? '#fbbf24' : '#ef4444';
                return (
                  <g key={e.id} onClick={() => { setIsPlaying(false); selectEvent(e.id); }} style={{ cursor: 'pointer' }}>
                    {e.isBigChance && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity={isSelected ? 1 : 0.45} />}
                    {isSelected && <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke="#ffffff" strokeWidth="2" filter="url(#glow)" />}
                    <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={isSelected ? 1 : 0.8} stroke="#ffffff" strokeWidth={isSelected ? 2.5 : 1} />
                    {e.outcome === 'goal' && <text x={cx} y={cy + 3.5} fontSize="9" textAnchor="middle" fill="#ffffff" fontWeight="900">⚽</text>}
                  </g>
                );
              }

              const isSevere = e.isFatal || e.netStatus === 'rusher_open_net';
              const isCovered = e.netStatus === 'covered';
              return (
                <g key={e.id} onClick={() => { setIsPlaying(false); selectEvent(e.id); }} style={{ cursor: 'pointer' }}>
                  {isSelected && <circle cx={cx} cy={cy} r="18" fill="none" stroke={isSevere ? '#ef4444' : isCovered ? '#38bdf8' : '#f59e0b'} strokeWidth="2" filter="url(#glow)" />}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSevere ? 12 : 9}
                    fill={isSevere ? '#991b1b' : isCovered ? '#0c2744' : '#78350f'}
                    stroke={isSevere ? '#ef4444' : isCovered ? '#38bdf8' : '#f59e0b'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                  <text x={cx} y={cy + 3.5} fontSize={isSevere ? '10' : '8'} textAnchor="middle" fill="#ffffff" fontWeight="900">
                    {isSevere ? '💀' : isCovered ? '🛡️' : '⚠️'}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Adaptive Legend (Only Relevant Markers) */}
          <div style={{ display: 'flex', gap: '14px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} /> Goal</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#38bdf8' }} /> Saved</span>
            {hasWoodwork && <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#fbbf24' }} /> Woodwork</span>}
            {hasMiss && <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} /> Miss</span>}
            {hasCovered && <span>🛡️ 3s Covered</span>}
            <span>⚠️ Open-Net Overlap</span>
            <span>💀 Fatal / Rushed Empty Net</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} /> 100 Boost</span>
          </div>
        </div>

        {/* Right Side: Play Inspector Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {selectedEvent ? (
            <div
              className="surface-card-elevated"
              style={{
                padding: '20px',
                borderColor:
                  selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                    ? 'rgba(239, 68, 68, 0.55)'
                    : selectedEvent.outcome === 'goal'
                    ? 'rgba(16, 185, 129, 0.5)'
                    : 'var(--border-hairline)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      backgroundColor: 'var(--bg-inset)',
                      border: '1px solid var(--border-hairline)',
                      color: 'var(--accent-cyan)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '6px',
                    }}
                  >
                    [{formatClock(selectedEvent.timeSec)}]
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                    {filteredEvents.findIndex(e => e.id === selectedEvent.id) + 1} / {filteredEvents.length}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    textTransform: 'uppercase',
                    backgroundColor:
                      selectedEvent.type === 'shot'
                        ? selectedEvent.outcome === 'goal' ? 'rgba(16, 185, 129, 0.2)' : 'var(--accent-cyan-soft)'
                        : selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                        ? 'rgba(239, 68, 68, 0.22)'
                        : selectedEvent.netStatus === 'covered'
                        ? 'var(--accent-cyan-soft)'
                        : 'rgba(245, 158, 11, 0.2)',
                    color:
                      selectedEvent.type === 'shot'
                        ? selectedEvent.outcome === 'goal' ? '#34d399' : 'var(--accent-cyan)'
                        : selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                        ? '#f87171'
                        : selectedEvent.netStatus === 'covered'
                        ? 'var(--accent-cyan)'
                        : '#fbbf24',
                    border:
                      selectedEvent.type === 'shot'
                        ? selectedEvent.outcome === 'goal' ? '1px solid #10b981' : '1px solid var(--accent-cyan)'
                        : selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                        ? '1px solid #ef4444'
                        : selectedEvent.netStatus === 'covered'
                        ? '1px solid var(--accent-cyan)'
                        : '1px solid #f59e0b',
                  }}
                >
                  {selectedEvent.type === 'shot'
                    ? `${selectedEvent.outcome} ${selectedEvent.isBigChance ? '★ BIG CHANCE' : ''}`
                    : selectedEvent.netStatus === 'rusher_open_net'
                    ? selectedEvent.isFatal ? '💀 FATAL EMPTY-NET RUSH' : '🚨 RUSHED EMPTY NET'
                    : selectedEvent.isFatal
                    ? '💀 FATAL OVERCOMMIT'
                    : selectedEvent.netStatus === 'covered'
                    ? '🛡️ 3RD MAN COVERED'
                    : '⚠️ OPEN-NET OVERLAP'}
                </span>
              </div>

              {selectedEvent.type === 'shot' ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                    <div>
                      <h4 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{selectedEvent.player1}</h4>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Team: {selectedEvent.teamNum === 0 ? 'Blue' : 'Orange'}</div>
                    </div>
                    {onInspectPlayer && findPlayerObj(selectedEvent.player1) && (
                      <button
                        type="button"
                        onClick={() => onInspectPlayer(findPlayerObj(selectedEvent.player1)!)}
                        className="glass-pill"
                        style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 800, color: 'var(--accent-cyan)', cursor: 'pointer' }}
                      >
                        👤 Dossier →
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>EXPECTED GOALS (xG)</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--accent-emerald)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                        {selectedEvent.xg?.toFixed(2)}
                      </div>
                    </div>
                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>STRIKE SPEED</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', marginTop: '2px' }}>
                        {selectedEvent.speedKmh ? `${Math.round(selectedEvent.speedKmh)} km/h` : 'N/A'}
                      </div>
                    </div>
                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>DISTANCE TO GOAL</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {selectedEvent.distance ? `${Math.round(selectedEvent.distance / 100)}m` : 'N/A'}
                      </div>
                    </div>
                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SHOT ELEVATION</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: (selectedEvent.z ?? 0) > 640 ? '#c084fc' : 'var(--text-secondary)', marginTop: '2px' }}>
                        {(selectedEvent.z ?? 0) > 640 ? 'High Aerial' : 'Ground/Low'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <h4 style={{ fontSize: '17px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                        {selectedEvent.player1} & {selectedEvent.player2}
                      </h4>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Team: {selectedEvent.teamNum === 0 ? 'Blue' : 'Orange'}
                        {selectedEvent.rawDC?.penalty_delta !== undefined && (
                          <span style={{ marginLeft: '8px', color: selectedEvent.netStatus === 'covered' ? 'var(--accent-cyan)' : '#f87171', fontWeight: 800 }}>
                            • Impact: {selectedEvent.rawDC.penalty_delta.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    {onInspectPlayer && findPlayerObj(selectedEvent.intruderName || selectedEvent.player2) && (
                      <button
                        type="button"
                        onClick={() => onInspectPlayer(findPlayerObj(selectedEvent.intruderName || selectedEvent.player2)!)}
                        className="glass-pill"
                        style={{ padding: '5px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 800, color: 'var(--accent-cyan)', cursor: 'pointer' }}
                      >
                        👤 Intruder Dossier →
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#f87171', fontWeight: 800, textTransform: 'uppercase' }}>
                        {selectedEvent.rawDC?.rushed_from_net
                          ? '🚨 LAST-MAN NET RUSHER (HIGH PENALTY)'
                          : selectedEvent.netStatus === 'covered'
                          ? '⚠️ TAILING INTRUDER (REDUCED PENALTY)'
                          : '⚠️ TAILING INTRUDER (PENALIZED)'}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#f87171', marginTop: '2px' }}>
                        {selectedEvent.intruderName || selectedEvent.player2}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {selectedEvent.rawDC?.rushed_from_net
                          ? 'Sprinted out of own defensive net into teammate while goal behind was empty.'
                          : selectedEvent.netStatus === 'covered' && selectedEvent.rawDC?.third_man_covering
                          ? `Overlapped into carrier space, while ${selectedEvent.rawDC.third_man_covering} covered net behind.`
                          : 'Tailed ball-carrier into contested space without goalie cover behind.'}
                      </div>
                    </div>

                    {selectedEvent.rawDC?.third_man_covering && (
                      <div className="surface-sub" style={{ padding: '10px', borderColor: 'rgba(56, 189, 248, 0.35)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--accent-cyan)', fontWeight: 800, textTransform: 'uppercase' }}>
                          🛡️ 3RD MAN NET COVERAGE
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-cyan)', marginTop: '2px' }}>
                          {selectedEvent.rawDC.third_man_covering}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Anchored defensive zone, preventing open-net exposure (+0.10 safety cover).
                        </div>
                      </div>
                    )}

                    <div className="surface-sub" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#34d399', fontWeight: 800, textTransform: 'uppercase' }}>
                        ⚽ BALL CARRIER (PROTECTED)
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#34d399', marginTop: '2px' }}>
                        {selectedEvent.carrierName || selectedEvent.player1}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Primary possession carrier; immunity applied.
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor:
                        selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                          ? 'rgba(239, 68, 68, 0.1)'
                          : selectedEvent.netStatus === 'covered'
                          ? 'var(--accent-cyan-soft)'
                          : 'rgba(245, 158, 11, 0.1)',
                      border:
                        selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                          ? '1px solid rgba(239, 68, 68, 0.3)'
                          : selectedEvent.netStatus === 'covered'
                          ? '1px solid rgba(56, 189, 248, 0.35)'
                          : '1px solid rgba(245, 158, 11, 0.3)',
                      fontSize: '12px',
                      color:
                        selectedEvent.isFatal || selectedEvent.netStatus === 'rusher_open_net'
                          ? '#fca5a5'
                          : selectedEvent.netStatus === 'covered'
                          ? '#bae6fd'
                          : '#fde68a',
                      lineHeight: 1.5,
                    }}
                  >
                    {selectedEvent.rawDC?.context_reason ||
                      (selectedEvent.isFatal
                        ? '💀 Fatal Concession: Opponent scored within 8.0s of this collision.'
                        : '⚠️ Spatial Overlap: Rotate behind carrier rather than double-committing.')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="surface-card" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No matching events for the selected filter.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="surface-sub" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>TOTAL SHOTS</div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--accent-cyan)', marginTop: '2px' }}>{shots.length}</div>
            </div>
            <div className="surface-sub" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>OVERLAPS LOGGED</div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--accent-amber)', marginTop: '2px' }}>{doubleCommits.length}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
