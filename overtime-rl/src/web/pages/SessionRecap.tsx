import React from 'react';
import type { SessionRecap } from '../../shared/types.ts';
import { RatingBadge } from '../components/RatingBadge.tsx';
import { SessionDiscordExport } from '../components/SessionDiscordExport.tsx';

interface SessionRecapProps {
  session: SessionRecap;
  onSelectMatch: (guid: string) => void;
  onOpenProfile?: (primaryId: string) => void;
}

export const SessionRecapView: React.FC<SessionRecapProps> = ({ session, onSelectMatch, onOpenProfile }) => {
  const podiumTop3 = session.podium.slice(0, 3);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Session Title Header - Liquid Glass */}
      <div
        style={{
          backgroundColor: 'rgba(13, 20, 36, 0.7)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderTop: '1px solid rgba(255, 255, 255, 0.22)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: '0 16px 40px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          padding: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff' }}>Grind Session Leaderboard</h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            {session.total_matches} Matches Analyzed • {session.wins} Wins ({session.win_rate}%) •{' '}
            <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
              {session.total_goals_for ?? 0} GF - {session.total_goals_against ?? 0} GA
            </span>{' '}
            •{' '}
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>
              {session.total_double_commits ?? 0} Double Commits
            </span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '10px 18px',
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              borderRadius: '10px',
              textAlign: 'center',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderTop: '1px solid rgba(147, 197, 253, 0.5)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>SESSION W/L</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#38bdf8' }}>
              {session.wins}W - {session.losses}L
            </div>
          </div>
          <SessionDiscordExport session={session} />
        </div>
      </div>

      {/* Player of the Night Podium */}
      {podiumTop3.length > 0 && (
        <div
          style={{
            backgroundColor: 'rgba(13, 20, 36, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderTop: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            padding: '28px',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#eab308',
              }}
            >
              Session Awards • You & Friends
            </span>
            <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#f8fafc', marginTop: '2px' }}>
              🏆 Player of the Night Podium
            </h3>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: '24px',
              paddingTop: '20px',
            }}
          >
            {/* 2nd Place */}
            {podiumTop3[1] && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  maxWidth: '220px',
                }}
              >
                <div style={{ fontSize: '24px', marginBottom: '6px' }}>🥈</div>
                <button
                  onClick={() => podiumTop3[1].primary_id && onOpenProfile?.(podiumTop3[1].primary_id)}
                  title={podiumTop3[1].primary_id ? 'Click to view career profile & 8-axis attributes' : undefined}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '16px',
                    color: '#f8fafc',
                    marginBottom: '4px',
                    cursor: podiumTop3[1].primary_id && onOpenProfile ? 'pointer' : 'default',
                    textDecoration: podiumTop3[1].primary_id && onOpenProfile ? 'underline dotted rgba(56,189,248,0.5)' : 'none',
                  }}
                >
                  {podiumTop3[1].name}
                </button>
                <RatingBadge score={podiumTop3[1].avg_rating} size="lg" />
                <div
                  style={{
                    marginTop: '12px',
                    width: '100%',
                    height: '110px',
                    backgroundColor: '#172238',
                    borderTop: '4px solid #94a3b8',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#94a3b8',
                  }}
                >
                  <div>{podiumTop3[1].matches_played} Matches</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{podiumTop3[1].win_rate}% Win Rate</div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '4px' }}>
                    {podiumTop3[1].total_goals}G · {podiumTop3[1].total_assists ?? 0}A · {podiumTop3[1].total_saves ?? 0}S · <span style={{ color: '#fbbf24' }}>{podiumTop3[1].total_double_commits ?? 0} DC</span>
                  </div>
                </div>
              </div>
            )}

            {/* 1st Place (Champion) */}
            {podiumTop3[0] && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  maxWidth: '240px',
                }}
              >
                <div style={{ fontSize: '32px', marginBottom: '6px' }}>👑</div>
                <button
                  onClick={() => podiumTop3[0].primary_id && onOpenProfile?.(podiumTop3[0].primary_id)}
                  title={podiumTop3[0].primary_id ? 'Click to view career profile & 8-axis attributes' : undefined}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontWeight: 900,
                    fontSize: '18px',
                    color: '#facc15',
                    marginBottom: '4px',
                    cursor: podiumTop3[0].primary_id && onOpenProfile ? 'pointer' : 'default',
                    textDecoration: podiumTop3[0].primary_id && onOpenProfile ? 'underline dotted rgba(250,204,21,0.5)' : 'none',
                  }}
                >
                  {podiumTop3[0].name}
                </button>
                <RatingBadge score={podiumTop3[0].avg_rating} size="lg" />
                <div
                  style={{
                    marginTop: '12px',
                    width: '100%',
                    height: '154px',
                    background: 'linear-gradient(180deg, #2a2415 0%, #151a28 100%)',
                    borderTop: '4px solid #eab308',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    color: '#cbd5e1',
                    boxShadow: '0 0 25px rgba(234, 179, 8, 0.15)',
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#facc15', fontSize: '14px' }}>PLAYER OF THE NIGHT</div>
                  <div style={{ marginTop: '4px' }}>{podiumTop3[0].matches_played} Matches • {podiumTop3[0].win_rate}% WR</div>
                  <div style={{ fontWeight: 700, color: '#ffffff', marginTop: '4px', fontSize: '12px' }}>
                    {podiumTop3[0].total_goals}G · {podiumTop3[0].total_assists ?? 0}A · {podiumTop3[0].total_saves ?? 0}S · <span style={{ color: '#fbbf24' }}>{podiumTop3[0].total_double_commits ?? 0} DC</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3rd Place */}
            {podiumTop3[2] && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  maxWidth: '220px',
                }}
              >
                <div style={{ fontSize: '24px', marginBottom: '6px' }}>🥉</div>
                <button
                  onClick={() => podiumTop3[2].primary_id && onOpenProfile?.(podiumTop3[2].primary_id)}
                  title={podiumTop3[2].primary_id ? 'Click to view career profile & 8-axis attributes' : undefined}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '16px',
                    color: '#f8fafc',
                    marginBottom: '4px',
                    cursor: podiumTop3[2].primary_id && onOpenProfile ? 'pointer' : 'default',
                    textDecoration: podiumTop3[2].primary_id && onOpenProfile ? 'underline dotted rgba(56,189,248,0.5)' : 'none',
                  }}
                >
                  {podiumTop3[2].name}
                </button>
                <RatingBadge score={podiumTop3[2].avg_rating} size="lg" />
                <div
                  style={{
                    marginTop: '12px',
                    width: '100%',
                    height: '96px',
                    backgroundColor: '#172238',
                    borderTop: '4px solid #b45309',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#94a3b8',
                  }}
                >
                  <div>{podiumTop3[2].matches_played} Matches</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{podiumTop3[2].win_rate}% Win Rate</div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '4px' }}>
                    {podiumTop3[2].total_goals}G · {podiumTop3[2].total_assists ?? 0}A · {podiumTop3[2].total_saves ?? 0}S · <span style={{ color: '#fbbf24' }}>{podiumTop3[2].total_double_commits ?? 0} DC</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Form Strip & Matches List */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', marginBottom: '14px' }}>
          Session Match History
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {session.matches.map(m => {
            const myGoals = m.user_team_num !== null && m.user_team_num !== undefined
              ? (m.user_team_num === 1 ? m.score_team1 : m.score_team0)
              : (m.is_win ? Math.max(m.score_team0, m.score_team1) : Math.min(m.score_team0, m.score_team1));
            const oppGoals = m.user_team_num !== null && m.user_team_num !== undefined
              ? (m.user_team_num === 1 ? m.score_team0 : m.score_team1)
              : (m.is_win ? Math.min(m.score_team0, m.score_team1) : Math.max(m.score_team0, m.score_team1));

            return (
              <div
                key={m.guid}
                onClick={() => onSelectMatch(m.guid)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 18px',
                  backgroundColor: '#141d2f',
                  borderRadius: '10px',
                  border: '1px solid #1c2a44',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1a273f')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#141d2f')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span
                    style={{
                      backgroundColor: m.is_win ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: m.is_win ? '#34d399' : '#f87171',
                      border: m.is_win ? '1px solid #10b981' : '1px solid #ef4444',
                      fontWeight: 800,
                      fontSize: '12px',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {m.is_win ? 'WIN' : 'LOSS'}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: '15px', color: '#f8fafc', letterSpacing: '0.02em' }}>
                    {myGoals} <span style={{ color: '#64748b' }}>-</span> {oppGoals}
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {new Date(m.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>Performance:</span>
                  <RatingBadge score={m.user_rating} size="md" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
