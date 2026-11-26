import React from 'react';
import type { PlayerCoachReport, DoubleCommitEvent, GoalCausalChain } from '../../shared/types.ts';
import { RatingBadge } from './RatingBadge.tsx';

interface CoachReportCardProps {
  report: PlayerCoachReport | null;
  doubleCommits?: DoubleCommitEvent[];
  concededGoalChains?: GoalCausalChain[];
}

export const CoachReportCard: React.FC<CoachReportCardProps> = ({
  report,
  doubleCommits = [],
  concededGoalChains = [],
}) => {
  if (!report) return null;

  return (
    <div
      className="surface-card"
      style={{
        overflow: 'hidden',
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          padding: '22px 28px',
          background: 'linear-gradient(135deg, var(--accent-cyan-soft) 0%, transparent 100%)',
          borderBottom: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
            }}
          >
            📋
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#10b981' }}>
                Tactical Match Diagnostics
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>• Personalized for {report.player_name}</span>
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#f8fafc', marginTop: '2px' }}>
              {report.verdict}
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px', maxWidth: '640px' }}>
              {report.verdict_summary}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>MATCH RATING</div>
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>FotMob Performance</div>
          </div>
          <RatingBadge score={report.rating} size="lg" />
        </div>
      </div>

      {/* Two Column Strengths vs Improvements */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '24px',
          padding: '28px',
          backgroundColor: 'var(--bg-inset)',
        }}
      >
        {/* Left Column: What You Did Great */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ color: '#10b981', fontSize: '18px' }}>✓</span>
            <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#10b981', letterSpacing: '-0.01em' }}>
              What You Did Great ({report.strengths.length})
            </h4>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {report.strengths.map((s, idx) => (
              <div
                key={idx}
                className="surface-sub"
                style={{
                  borderLeft: '4px solid #10b981',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <h5 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{s.title}</h5>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                    }}
                  >
                    {s.tag}
                  </span>
                </div>
                <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{s.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Areas for Improvement */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ color: '#f59e0b', fontSize: '18px' }}>▲</span>
            <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#f59e0b', letterSpacing: '-0.01em' }}>
              Actionable Coaching & Improvements ({report.improvements.length})
            </h4>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {report.improvements.map((imp, idx) => (
              <div
                key={idx}
                className="surface-sub"
                style={{
                  borderLeft: '4px solid #f59e0b',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <h5 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{imp.title}</h5>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: '#fbbf24',
                    }}
                  >
                    {imp.tag}
                  </span>
                </div>
                <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{imp.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Conceded Goal 3-Step Causal Chain Autopsy */}
      {concededGoalChains.length > 0 && (
        <div
          style={{
            padding: '24px 28px',
            backgroundColor: 'var(--bg-card)',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>🎬</span>
              <h4 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Conceded Goal Causal Film Strip ({concededGoalChains.length})
              </h4>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              10-second buildup attribution: Origin → Breakdown → Net Impact
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {concededGoalChains.map(chain => {
              const gm = Math.floor(chain.time_seconds / 60);
              const gs = Math.floor(chain.time_seconds % 60);
              const gClock = `${gm.toString().padStart(2, '0')}:${gs.toString().padStart(2, '0')}`;
              return (
                <div key={chain.goal_id} className="surface-sub" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 800,
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(239, 68, 68, 0.14)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                        }}
                      >
                        [{gClock}] CONCEDED
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                        Scored by <strong style={{ color: '#fb923c' }}>{chain.scorer_name}</strong>
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
                      Shot Quality: <strong style={{ color: '#e2e8f0' }}>{chain.shot_xg.toFixed(2)} xG</strong> • Key Driver:{' '}
                      <strong style={{ color: '#fbbf24' }}>{chain.primary_attribution}</strong>
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, chain.steps.length)}, minmax(0, 1fr))`, gap: '10px' }}>
                    {chain.steps.map((step, sIdx) => {
                      const sevColor =
                        step.severity === 'high' ? '#ef4444' : step.severity === 'medium' ? '#f59e0b' : '#38bdf8';
                      return (
                        <div
                          key={sIdx}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            backgroundColor: 'var(--bg-card)',
                            border: `1px solid ${step.severity === 'high' ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-hairline)'}`,
                            borderTop: `3px solid ${sevColor}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 900, fontFamily: 'var(--font-mono)', color: sevColor }}>
                              {step.offset_label}
                            </span>
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(255,255,255,0.06)',
                                color: '#cbd5e1',
                              }}
                            >
                              {step.category}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', fontWeight: 800, color: '#f8fafc' }}>{step.title}</div>
                          <div style={{ fontSize: '11px', lineHeight: 1.4, color: 'var(--text-secondary)' }}>{step.detail}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Double-Commit Incidents & Collision Log */}
      <div style={{ padding: '24px 28px', backgroundColor: 'var(--bg-card)', borderTop: '1px solid var(--border-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <h4 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Double-Commit Incidents & Rotation Telemetry ({doubleCommits.length})
            </h4>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Threshold: Δt ≤ 400ms & Δdist ≤ 650 units
          </span>
        </div>

        {doubleCommits.length === 0 ? (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '10px',
              backgroundColor: '#0a1a1e',
              border: '1px solid #064e3b',
              color: '#34d399',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '16px', fontWeight: 900 }}>✓</span>
            <span>
              <strong>Flawless Rotational Spacing:</strong> Zero teammate collisions or double-commit contest conflicts detected throughout regulation.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {doubleCommits.map((dc, i) => {
              const m = Math.floor(dc.time_seconds / 60);
              const s = Math.floor(dc.time_seconds % 60);
              const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    backgroundColor: dc.is_fatal ? 'rgba(239, 68, 68, 0.08)' : '#121c2e',
                    border: dc.is_fatal ? '1px solid #dc2626' : '1px solid #1e2c47',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: '#38bdf8',
                        fontSize: '12px',
                        backgroundColor: '#17253d',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #233758',
                      }}
                    >
                      {timeStr}
                    </span>
                    <div>
                      <div style={{ fontWeight: 800, color: '#f8fafc', fontSize: '14px' }}>
                        {dc.player1_name} <span style={{ color: '#94a3b8' }}>&</span> {dc.player2_name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                        Simultaneous contest on the ball in close proximity.
                        {dc.is_fatal ? ' Directly compromised defensive rotation, resulting in opponent goal.' : ' Last man was pulled out of defensive shape.'}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: dc.is_fatal ? '#7f1d1d' : '#3b2509',
                      color: dc.is_fatal ? '#fca5a5' : '#fcd34d',
                      border: dc.is_fatal ? '1px solid #ef4444' : '1px solid #f59e0b',
                    }}
                  >
                    {dc.is_fatal ? '🚨 FATAL CONCESSION' : '⚠️ DOUBLE COMMIT'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
