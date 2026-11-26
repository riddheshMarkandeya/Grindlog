import React from 'react';

interface RatingBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  showDetailsHint?: boolean;
}

export const RatingBadge: React.FC<RatingBadgeProps> = ({
  score,
  size = 'md',
  onClick,
  showDetailsHint = false,
}) => {
  // 2026 Liquid Glass & High-Contrast WCAG-Compliant Sports Rating
  // Dark obsidian tinted glass container with specular bevel highlights and razor-sharp typography
  const getBadgeStyle = (s: number) => {
    if (s >= 10.0) {
      return {
        backgroundColor: 'rgba(30, 64, 175, 0.42)', // Deep Royal Glass
        border: '1px solid rgba(96, 165, 250, 0.35)',
        borderTop: '1px solid rgba(147, 197, 253, 0.75)', // Specular highlight
        color: '#93c5fd', // Ice Blue (Contrast 9.4:1)
        accentGlow: 'rgba(96, 165, 250, 0.25)',
      };
    }
    if (s >= 9.0) {
      return {
        backgroundColor: 'rgba(6, 78, 59, 0.42)', // Deep Emerald Glass
        border: '1px solid rgba(16, 185, 129, 0.35)',
        borderTop: '1px solid rgba(52, 211, 153, 0.75)',
        color: '#34d399', // Crisp Emerald (Contrast 8.5:1)
        accentGlow: 'rgba(52, 211, 153, 0.25)',
      };
    }
    if (s >= 8.0) {
      return {
        backgroundColor: 'rgba(15, 118, 110, 0.42)', // Deep Teal Glass
        border: '1px solid rgba(20, 184, 166, 0.35)',
        borderTop: '1px solid rgba(45, 212, 191, 0.75)',
        color: '#2dd4bf', // Crisp Teal (Contrast 8.5:1)
        accentGlow: 'rgba(45, 212, 191, 0.25)',
      };
    }
    if (s >= 7.0) {
      return {
        backgroundColor: 'rgba(12, 74, 110, 0.42)', // Deep Sky Glass
        border: '1px solid rgba(14, 165, 233, 0.35)',
        borderTop: '1px solid rgba(56, 189, 248, 0.75)',
        color: '#38bdf8', // Crisp Sky Blue (Contrast 8.7:1)
        accentGlow: 'rgba(56, 189, 248, 0.25)',
      };
    }
    if (s >= 6.0) {
      return {
        backgroundColor: 'rgba(120, 53, 15, 0.42)', // Deep Warm Amber Glass
        border: '1px solid rgba(245, 158, 11, 0.35)',
        borderTop: '1px solid rgba(251, 191, 36, 0.75)',
        color: '#fbbf24', // Crisp Amber (Contrast 8.0:1)
        accentGlow: 'rgba(251, 191, 36, 0.25)',
      };
    }
    return {
      backgroundColor: 'rgba(127, 29, 29, 0.42)', // Deep Ruby Glass
      border: '1px solid rgba(239, 68, 68, 0.35)',
      borderTop: '1px solid rgba(248, 113, 113, 0.75)',
      color: '#f87171', // Crisp Coral Rose (Contrast 7.9:1)
      accentGlow: 'rgba(248, 113, 113, 0.25)',
    };
  };

  const sizeStyles: Record<'sm' | 'md' | 'lg', React.CSSProperties> = {
    sm: {
      minWidth: '40px',
      height: '24px',
      padding: '0 7px',
      fontSize: '12.5px',
      borderRadius: '6px',
    },
    md: {
      minWidth: '48px',
      height: '28px',
      padding: '0 9px',
      fontSize: '14px',
      borderRadius: '7px',
    },
    lg: {
      minWidth: '62px',
      height: '36px',
      padding: '0 12px',
      fontSize: '18px',
      borderRadius: '9px',
    },
  };

  const style = getBadgeStyle(score);
  const sizeStyle = sizeStyles[size];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={showDetailsHint ? 'Click to inspect itemized FotMob breakdown' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 800,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        backgroundColor: style.backgroundColor,
        border: style.border,
        borderTop: style.borderTop,
        color: style.color,
        boxShadow: `0 2px 8px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.18)`,
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.75)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        ...sizeStyle,
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-1px) scale(1.04)';
          e.currentTarget.style.boxShadow = `0 4px 12px ${style.accentGlow}, inset 0 1px 0 rgba(255, 255, 255, 0.3)`;
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.18)`;
        }
      }}
    >
      {score.toFixed(1)}
    </button>
  );
};
