import React, { useState, useMemo } from 'react';

export interface ScrubberEvent {
  id: string;
  type: 'shot' | 'double_commit';
  timeSec: number;
  player1: string;
  player2?: string;
  outcome?: string;
  xg?: number;
  isFatal?: boolean;
  netStatus?: string;
}

interface TimelineScrubberProps {
  events: ScrubberEvent[];
  maxDuration: number;
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const getEventPinMeta = (e: ScrubberEvent): { color: string; label: string; isBottomLane: boolean } => {
  if (e.type === 'shot') {
    const color =
      e.outcome === 'goal'
        ? '#10b981'
        : e.outcome === 'woodwork'
        ? '#fbbf24'
        : e.outcome === 'miss'
        ? '#f87171'
        : '#38bdf8';
    const icon = e.outcome === 'goal' ? '⚽' : '🎯';
    const xgTxt = e.xg !== undefined ? ` • ${e.xg.toFixed(2)} xG` : '';
    return {
      color,
      label: `${icon} ${e.player1} (${e.outcome || 'shot'})${xgTxt}`,
      isBottomLane: false,
    };
  }

  const isRusherOrFatal = e.isFatal || e.netStatus === 'rusher_open_net';
  const color = isRusherOrFatal
    ? '#f43f5e'
    : e.netStatus === 'covered'
    ? '#38bdf8'
    : '#f59e0b';
  const badge = isRusherOrFatal
    ? '🚨'
    : e.netStatus === 'covered'
    ? '🛡️'
    : '⚠️';
  return {
    color,
    label: `${badge} ${e.player1} & ${e.player2 || 'Teammate'}`,
    isBottomLane: true,
  };
};

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  events,
  maxDuration,
  selectedEventId,
  onSelectEvent,
  isPlaying,
  onTogglePlay,
  onPrev,
  onNext,
}) => {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const selectedEvent = useMemo(
    () => events.find(e => e.id === selectedEventId) || null,
    [events, selectedEventId]
  );

  const findClosestEvent = (targetSec: number): ScrubberEvent | null => {
    if (events.length === 0) return null;
    let closest = events[0];
    let minDiff = Math.abs(events[0].timeSec - targetSec);
    for (const ev of events) {
      const diff = Math.abs(ev.timeSec - targetSec);
      if (diff < minDiff) {
        minDiff = diff;
        closest = ev;
      }
    }
    return closest;
  };

  const activeTime = hoverTime !== null ? hoverTime : selectedEvent?.timeSec ?? 0;
  const activePct = Math.min(100, Math.max(0, (activeTime / Math.max(1, maxDuration)) * 100));
  const previewEvent = useMemo(
    () => (hoverTime !== null ? findClosestEvent(hoverTime) : selectedEvent),
    [hoverTime, selectedEvent, events]
  );

  return (
    <div
      className="surface-sub"
      style={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={events.length === 0}
            style={{
              backgroundColor: isPlaying ? 'rgba(244, 63, 94, 0.18)' : 'var(--accent-cyan-soft)',
              color: isPlaying ? '#fb7185' : 'var(--accent-cyan)',
              border: `1px solid ${isPlaying ? 'rgba(244, 63, 94, 0.45)' : 'var(--border-hairline)'}`,
              borderRadius: '8px',
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: events.length === 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
            title="Auto-play key events (Space)"
          >
            {isPlaying ? '⏸ Pause' : '▶ Play Highlights'}
          </button>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              onClick={onPrev}
              disabled={events.length === 0}
              className="glass-pill"
              style={{ color: 'var(--text-primary)', padding: '4px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
              title="Previous play (←)"
            >
              ◀ Prev
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={events.length === 0}
              className="glass-pill"
              style={{ color: 'var(--text-primary)', padding: '4px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
              title="Next play (→)"
            >
              Next ▶
            </button>
          </div>

          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
            TIMELINE SCRUBBER • Drag or click pins (←/→/Space)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {previewEvent && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              {getEventPinMeta(previewEvent).label}
            </span>
          )}
          <span
            style={{
              fontSize: '12px',
              color: 'var(--accent-cyan)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              backgroundColor: 'var(--bg-inset)',
              padding: '3px 9px',
              borderRadius: '6px',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {formatClock(activeTime)} / {formatClock(maxDuration)}
          </span>
        </div>
      </div>

      {/* Interactive Slider Track with Dual Lanes (Top: Shots/Goals, Bottom: Spacing Overlaps) */}
      <div
        style={{ position: 'relative', height: '42px', display: 'flex', alignItems: 'center', padding: '0 2px' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setHoverTime(Math.round(ratio * maxDuration));
        }}
        onMouseLeave={() => {
          if (!isDragging) setHoverTime(null);
        }}
      >
        {/* Rail background */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: '6px',
            transform: 'translateY(-50%)',
            backgroundColor: 'var(--bg-inset)',
            borderRadius: '999px',
            border: '1px solid var(--border-hairline)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${activePct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent-cyan-soft), var(--accent-cyan))',
              borderRadius: '999px',
            }}
          />
        </div>

        {/* Event Markers (Upper lane = Shots/Goals, Lower lane = Overlaps) */}
        {events.map(e => {
          const leftPct = Math.min(100, Math.max(0, (e.timeSec / Math.max(1, maxDuration)) * 100));
          const isSelected = e.id === selectedEventId;
          const meta = getEventPinMeta(e);
          const isGoal = e.type === 'shot' && e.outcome === 'goal';
          return (
            <button
              key={`pin-${e.id}`}
              type="button"
              onClick={() => onSelectEvent(e.id)}
              title={`[${formatClock(e.timeSec)}] ${meta.label}`}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                top: meta.isBottomLane ? '25px' : '4px',
                width: isSelected ? '11px' : isGoal ? '9px' : '6px',
                height: isSelected ? '11px' : isGoal ? '9px' : '6px',
                borderRadius: e.type === 'double_commit' ? '2px' : '50%',
                backgroundColor: meta.color,
                border: isSelected ? '2px solid #ffffff' : '1px solid rgba(0,0,0,0.6)',
                transform: `translateX(-50%) ${e.type === 'double_commit' ? 'rotate(45deg)' : ''}`,
                boxShadow: isSelected ? `0 0 10px ${meta.color}` : 'none',
                cursor: 'pointer',
                zIndex: isSelected ? 6 : 3,
                padding: 0,
                transition: 'transform 0.1s ease, width 0.1s ease',
              }}
            />
          );
        })}

        {/* Floating Preview Callout on Hover/Drag */}
        {hoverTime !== null && previewEvent && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(90, Math.max(10, activePct))}%`,
              bottom: '44px',
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--bg-card-elevated)',
              border: '1px solid var(--border-specular-top)',
              borderRadius: '8px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 8px 20px rgba(0,0,0,0.55)',
              zIndex: 20,
            }}
          >
            [{formatClock(previewEvent.timeSec)}] {getEventPinMeta(previewEvent).label}
          </div>
        )}

        {/* Native Smooth Drag Input Overlaid */}
        <input
          type="range"
          className="timeline-slider"
          min={0}
          max={maxDuration}
          step={1}
          value={activeTime}
          aria-label="Match Timeline Scrubber"
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          onChange={e => {
            const val = Number(e.target.value);
            setHoverTime(val);
            const snap = findClosestEvent(val);
            if (snap && snap.id !== selectedEventId) {
              onSelectEvent(snap.id);
            }
          }}
        />
      </div>
    </div>
  );
};
