import React from 'react';

export interface RotationBadgeProps {
  count: number;
  fatalCount?: number;
  elgCount?: number;
  is2v2?: boolean;
  size?: 'sm' | 'md';
}

/**
 * RotationBadge renders high-contrast, elevated glass-styled pills
 * for double commits, rotational collisions, and errors leading to goal (ELG).
 */
export const RotationBadge: React.FC<RotationBadgeProps> = ({
  count,
  fatalCount = 0,
  elgCount = 0,
  is2v2 = false,
  size = 'sm',
}) => {
  const totalErrors = count + elgCount;

  if (totalErrors <= 0) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: size === 'sm' ? '3px 8px' : '4px 10px',
          borderRadius: '6px',
          fontSize: size === 'sm' ? '11px' : '12px',
          fontWeight: 700,
          backgroundColor: '#0f172a',
          color: '#94a3b8',
          border: '1px solid #1e293b',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        }}
        title="Zero double commits or fatal turnovers — clean rotations"
      >
        <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 900 }}>✓</span>
        <span>Clean (0)</span>
      </span>
    );
  }

  const isFatal = is2v2 || fatalCount > 0 || elgCount > 0 || count >= 3;
  const isDanger = count >= 2 || isFatal;

  if (isDanger) {
    let label = '';
    if (count > 0 && elgCount > 0) {
      label = `${count} DC • ${elgCount} ELG`;
    } else if (elgCount > 0) {
      label = `${elgCount} Fatal TO / ELG`;
    } else {
      label = `${count} DC${is2v2 ? ' (Fatal)' : ''}`;
    }

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: size === 'sm' ? '3px 9px' : '4px 12px',
          borderRadius: '6px',
          fontSize: size === 'sm' ? '11px' : '12px',
          fontWeight: 800,
          backgroundColor: '#3b0d0c',
          color: '#fca5a5',
          border: '1px solid #dc2626',
          whiteSpace: 'nowrap',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }}
        title={
          elgCount > 0
            ? `${elgCount} Error(s) Leading to Goal (defensive third turnover/failed clear)`
            : is2v2
            ? 'Fatal in 2s (no third defender back)'
            : `${count} double commits (severe rotation overlap)`
        }
      >
        <span style={{ fontSize: '11px' }}>🚨</span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: size === 'sm' ? '3px 9px' : '4px 12px',
        borderRadius: '6px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontWeight: 800,
        backgroundColor: '#271202',
        color: '#fbbf24',
        border: '1px solid #b45309',
        whiteSpace: 'nowrap',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      }}
      title={`${count} double commit collision`}
    >
      <span style={{ fontSize: '11px' }}>⚠️</span>
      <span>{count} DC</span>
    </span>
  );
};
