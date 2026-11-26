import React from 'react';
import type { RadarProfile } from '../../shared/types.ts';
import { calculateTacticalOvr } from '../../shared/ovr.ts';

interface OvrBadgeProps {
  radar: RadarProfile;
  variant?: 'pill' | 'tile' | 'inline';
}

/**
 * Displays Role-Weighted OVR (0-99) alongside raw /800 Tactical Power Total
 * using a single shared visual design across radar cards, modals, and profiles.
 */
export const OvrBadge: React.FC<OvrBadgeProps> = ({ radar, variant = 'pill' }) => {
  const { ovr, total800, tier, accentColor, topDrivers } = calculateTacticalOvr(radar);
  const tooltip = `${radar.archetype} Role OVR ${ovr}/99 (${tier}) • ${total800}/800 Total\nTop role weights: ${topDrivers
    .map(d => `${d.label} ${d.weightPct}%`)
    .join(', ')}`;

  if (variant === 'inline') {
    return (
      <span
        title={tooltip}
        style={{
          fontSize: '11px',
          fontWeight: 800,
          color: accentColor,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
        }}
      >
        {ovr} OVR <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({total800}/800)</span>
      </span>
    );
  }

  if (variant === 'tile') {
    return (
      <div
        className="surface-sub"
        title={tooltip}
        style={{
          padding: '12px 16px',
          textAlign: 'center',
          minWidth: '124px',
        }}
      >
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>
          TACTICAL OVR
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '4px', marginTop: '4px' }}>
          <span style={{ fontSize: '22px', fontWeight: 900, color: accentColor, fontFamily: 'var(--font-mono)' }}>
            {ovr}
          </span>
          <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)' }}>{tier}</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {total800} / 800 Total
        </div>
      </div>
    );
  }

  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 9px',
        borderRadius: '14px',
        backgroundColor: 'var(--bg-subcard)',
        border: `1px solid ${accentColor}`,
        whiteSpace: 'nowrap',
        cursor: 'help',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 900, color: accentColor, fontFamily: 'var(--font-mono)' }}>
        {ovr} OVR
      </span>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
        {total800}/800
      </span>
    </span>
  );
};
