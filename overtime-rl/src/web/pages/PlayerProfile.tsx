import React, { useState, useEffect } from 'react';
import type { PlayerProfile, RadarProfile } from '../../shared/types.ts';
import { RatingBadge } from '../components/RatingBadge.tsx';
import { RadarChart } from '../components/RadarChart.tsx';
import { OvrBadge } from '../components/OvrBadge.tsx';

interface FriendSwitcherItem {
  name: string;
  primary_id: string;
  is_pinned_friend?: boolean;
  matches_together?: number;
  chemistry_score?: number;
}

interface PlayerProfileProps {
  profile: PlayerProfile;
  onSelectMatch: (guid: string) => void;
  onSelectPlayerProfile?: (primaryId: string | null) => void;
}

export const PlayerProfileView: React.FC<PlayerProfileProps> = ({
  profile,
  onSelectMatch,
  onSelectPlayerProfile,
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'shooting' | 'defense' | 'movement' | 'boost'>('all');
  const [isFriend, setIsFriend] = useState<boolean>(false);
  const [squadPlayers, setSquadPlayers] = useState<FriendSwitcherItem[]>([]);
  const [userBaselineRadar, setUserBaselineRadar] = useState<RadarProfile | null>(null);

  useEffect(() => {
    fetch('/api/squad/friends')
      .then(r => r.json())
      .then((list: FriendSwitcherItem[]) => {
        if (Array.isArray(list)) setSquadPlayers(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile.is_user && !userBaselineRadar) {
      fetch('/api/player/profile')
        .then(r => r.json())
        .then((u: PlayerProfile) => {
          if (u?.radar) setUserBaselineRadar(u.radar);
        })
        .catch(() => {});
    }
  }, [profile.is_user]);

  useEffect(() => {
    if (!profile.is_user && profile.primary_id) {
      fetch('/api/friends')
        .then(r => r.json())
        .then(friends => {
          if (Array.isArray(friends)) {
            setIsFriend(friends.some((f: any) => f.primary_id === profile.primary_id));
          }
        })
        .catch(err => console.error('Failed to check friend status:', err));
    }
  }, [profile.primary_id, profile.is_user]);

  const handleToggleFriend = async () => {
    try {
      const res = await fetch('/api/friends/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: profile.primary_id, name: profile.name }),
      }).then(r => r.json());
      setIsFriend(res.is_pinned);
    } catch (err) {
      console.error('Failed to toggle friend:', err);
    }
  };

  const { attributes, radar } = profile;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Profile Hero Header - Elevated Liquid Glass */}
      <div
        style={{
          backgroundColor: 'rgba(13, 20, 36, 0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderTop: '1px solid rgba(255, 255, 255, 0.22)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 16px 40px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          padding: '28px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          {/* Identity info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '28px',
                color: '#ffffff',
                boxShadow: '0 4px 18px rgba(56, 189, 248, 0.4)',
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#f8fafc', letterSpacing: '-0.02em', margin: 0 }}>
                  {profile.name}
                </h2>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    backgroundColor: profile.is_user ? '#065f46' : '#1e293b',
                    color: profile.is_user ? '#34d399' : '#94a3b8',
                    border: profile.is_user ? '1px solid #10b981' : '1px solid #334155',
                  }}
                >
                  {profile.is_user ? '★ PRIMARY USER' : 'SCOUTED PLAYER'}
                </span>
                {!profile.is_user && onSelectPlayerProfile && (
                  <button
                    type="button"
                    onClick={() => onSelectPlayerProfile(null)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '20px',
                      backgroundColor: 'rgba(56, 189, 248, 0.14)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      cursor: 'pointer',
                    }}
                  >
                    ← Back to My Profile
                  </button>
                )}
                {!profile.is_user && (
                  <button
                    onClick={handleToggleFriend}
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      padding: '3px 12px',
                      borderRadius: '20px',
                      backgroundColor: isFriend ? '#065f46' : '#1e293b',
                      color: isFriend ? '#34d399' : '#f59e0b',
                      border: isFriend ? '1px solid #10b981' : '1px solid #d97706',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title={isFriend ? 'Click to unpin friend' : 'Click to pin as friend'}
                  >
                    {isFriend ? '⭐ PINNED FRIEND' : '☆ ADD TO SQUAD'}
                  </button>
                )}
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
                    color: '#ffffff',
                  }}
                >
                  {radar.archetype}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                Platform ID: <code style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{profile.primary_id}</code>
              </div>
            </div>
          </div>

          {/* Quick Hero Numbers */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {/* Tactical OVR & /800 */}
            <OvrBadge radar={radar} variant="tile" />

            {/* Career Rating */}
            <div
              style={{
                backgroundColor: '#142036',
                border: '1px solid #1e2f4f',
                padding: '12px 18px',
                borderRadius: '12px',
                textAlign: 'center',
                minWidth: '100px',
              }}
            >
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>
                CAREER RATING
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
                <RatingBadge score={profile.career_rating} size="lg" />
              </div>
            </div>

            {/* Win Rate */}
            <div
              style={{
                backgroundColor: '#142036',
                border: '1px solid #1e2f4f',
                padding: '12px 18px',
                borderRadius: '12px',
                textAlign: 'center',
                minWidth: '110px',
              }}
            >
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>
                WIN RATE
              </div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: '#34d399', marginTop: '4px' }}>
                {profile.win_rate}%
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {profile.wins}W - {profile.losses}L
              </div>
            </div>

            {/* Matches & Playtime */}
            <div
              style={{
                backgroundColor: '#142036',
                border: '1px solid #1e2f4f',
                padding: '12px 18px',
                borderRadius: '12px',
                textAlign: 'center',
                minWidth: '110px',
              }}
            >
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>
                MATCHES
              </div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
                {profile.total_matches}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {Math.round(profile.total_playtime_minutes / 60)} hrs on pitch
              </div>
            </div>
          </div>
        </div>

        {/* Recent 15 Matches Form Strip + Rating Trend Curve */}
        <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border-hairline)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
              Recent Form & Rating Curve (Last {profile.recent_matches.length})
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Click any node or match pill to open Match Center</span>
          </div>

          {profile.recent_matches.length >= 2 && (() => {
            const ordered = [...profile.recent_matches].sort((a, b) => a.started_at - b.started_at);
            const w = 640;
            const h = 68;
            const padX = 16;
            const padY = 12;
            const minR = 4.0;
            const maxR = 10.0;
            const pts = ordered.map((m, idx) => {
              const x = ordered.length === 1 ? w / 2 : padX + (idx / (ordered.length - 1)) * (w - padX * 2);
              const clamped = Math.max(minR, Math.min(maxR, m.rating));
              const y = padY + (1 - (clamped - minR) / (maxR - minR)) * (h - padY * 2);
              return { x, y, m };
            });
            const polylinePoints = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            const baselineY = padY + (1 - (6.0 - minR) / (maxR - minR)) * (h - padY * 2);
            return (
              <div className="surface-sub" style={{ padding: '8px 12px', marginBottom: '12px' }}>
                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '68px', overflow: 'visible', display: 'block' }}>
                  <line
                    x1={padX}
                    y1={baselineY}
                    x2={w - padX}
                    y2={baselineY}
                    stroke="rgba(148,163,184,0.22)"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  <polyline
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polylinePoints}
                  />
                  {pts.map(p => (
                    <circle
                      key={p.m.guid}
                      cx={p.x}
                      cy={p.y}
                      r={4.2}
                      fill={p.m.is_win ? 'var(--accent-win)' : 'var(--accent-loss)'}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelectMatch(p.m.guid)}
                    >
                      <title>{`${new Date(p.m.started_at).toLocaleDateString()} — Rating ${p.m.rating.toFixed(1)} (${p.m.is_win ? 'WIN' : 'LOSS'})`}</title>
                    </circle>
                  ))}
                </svg>
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {profile.recent_matches.map(m => (
              <div
                key={m.guid}
                onClick={() => onSelectMatch(m.guid)}
                title={`Click to inspect match (${m.goals}G, ${m.assists}A, ${m.saves}S)`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#141d2f',
                  border: m.is_win ? '1px solid #065f46' : '1px solid #7f1d1d',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 900,
                    padding: '2px 5px',
                    borderRadius: '4px',
                    backgroundColor: m.is_win ? '#065f46' : '#991b1b',
                    color: '#ffffff',
                  }}
                >
                  {m.is_win ? 'W' : 'L'}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#f8fafc' }}>
                  {m.rating.toFixed(1)}
                </span>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  ({m.goals}G)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Tactical Radar & AI Career Diagnostics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Left: SofaScore 6-Axis Tactical Radar + Friend Baseline Comparison */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <RadarChart radar={radar} playerName={`${profile.name} (Career)`} size={320} />

          {!profile.is_user && userBaselineRadar && (
            <div className="surface-card" style={{ width: '100%', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                vs Your Career Baseline
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                {[
                  { label: 'Finishing', val: radar.finishing, base: userBaselineRadar.finishing },
                  { label: 'Creation', val: radar.creation, base: userBaselineRadar.creation },
                  { label: 'Defense', val: radar.defense, base: userBaselineRadar.defense },
                  { label: 'Boost IQ', val: radar.boost_iq, base: userBaselineRadar.boost_iq },
                  { label: 'Aerial', val: radar.aerial ?? 50, base: userBaselineRadar.aerial ?? 50 },
                  { label: 'Discipline', val: radar.positioning ?? 50, base: userBaselineRadar.positioning ?? 50 },
                ].map(item => {
                  const diff = Math.round(item.val - item.base);
                  const diffColor = diff > 0 ? 'var(--accent-win)' : diff < 0 ? 'var(--accent-loss)' : 'var(--text-secondary)';
                  return (
                    <div key={item.label} className="surface-sub" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{item.label}</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--text-primary)' }}>{Math.round(item.val)}</span>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: diffColor }}>
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: AI Career Diagnostics */}
        <div
          className="surface-card"
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '22px' }}>🎯</span>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  Career Tactical Diagnostics
                </h3>
                <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                  Longitudinal assessment across all {profile.total_matches} matches
                </p>
              </div>
            </div>

            {/* Strengths */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginBottom: '8px' }}>
                ✓ Core Career Strengths
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {profile.strengths.map((str, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      borderLeft: '3px solid #10b981',
                      padding: '8px 12px',
                      borderRadius: '0 8px 8px 0',
                      fontSize: '12px',
                      color: '#e2e8f0',
                      lineHeight: 1.4,
                    }}
                  >
                    {str}
                  </div>
                ))}
              </div>
            </div>

            {/* Improvements */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginBottom: '8px' }}>
                ⚠ Priority Growth Areas
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {profile.improvements.map((imp, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.08)',
                      borderLeft: '3px solid #f59e0b',
                      padding: '8px 12px',
                      borderRadius: '0 8px 8px 0',
                      fontSize: '12px',
                      color: '#e2e8f0',
                      lineHeight: 1.4,
                    }}
                  >
                    {imp}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Comprehensive Career Attributes Cards */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Career Statistical Telemetry
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
              Cumulative averages across all {profile.total_matches} recorded matches
            </p>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '6px', backgroundColor: '#0c121e', padding: '4px', borderRadius: '10px', border: '1px solid #1c273e' }}>
            {[
              { id: 'all', label: 'All Attributes' },
              { id: 'shooting', label: 'Finishing' },
              { id: 'defense', label: 'Defense' },
              { id: 'movement', label: 'Movement' },
              { id: 'boost', label: 'Boost IQ' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id as any)}
                style={{
                  backgroundColor: activeCategory === cat.id ? '#1e2c47' : 'transparent',
                  color: activeCategory === cat.id ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stat Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          {/* Shooting */}
          {(activeCategory === 'all' || activeCategory === 'shooting') && (
            <>
              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>TOTAL GOALS</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#34d399', marginTop: '4px' }}>
                  {attributes.total_goals}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.goals_per_game} goals per match
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>SHOT CONVERSION</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
                  {attributes.shot_conversion_pct}%
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.total_shots} total shots ({attributes.shots_per_game}/game)
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>MAX SHOT VELOCITY</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#f59e0b', marginTop: '4px' }}>
                  {Math.round(attributes.hardest_shot_kmh)} <span style={{ fontSize: '14px', color: '#94a3b8' }}>km/h</span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.total_woodwork_hits} crossbar/post hits
                </div>
              </div>
            </>
          )}

          {/* Defense & Playmaking */}
          {(activeCategory === 'all' || activeCategory === 'defense') && (
            <>
              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>TOTAL SAVES</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
                  {attributes.total_saves}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.saves_per_game} saves per match
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>TOTAL ASSISTS</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#60a5fa', marginTop: '4px' }}>
                  {attributes.total_assists}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.assists_per_game} assists per match
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>TOUCH DISTRIBUTION</div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', fontSize: '12px', fontWeight: 800 }}>
                  <span style={{ color: '#38bdf8' }}>{attributes.touch_distribution.defence_pct}% Def</span>
                  <span style={{ color: '#94a3b8' }}>•</span>
                  <span style={{ color: '#eab308' }}>{attributes.touch_distribution.midfield_pct}% Mid</span>
                  <span style={{ color: '#94a3b8' }}>•</span>
                  <span style={{ color: '#10b981' }}>{attributes.touch_distribution.attack_pct}% Att</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Dominant in {attributes.touch_distribution.midfield_pct >= attributes.touch_distribution.defence_pct ? 'midfield transitions' : 'deep defensive 3rd'}
                </div>
              </div>
            </>
          )}

          {/* Movement & Physicality */}
          {(activeCategory === 'all' || activeCategory === 'movement') && (
            <>
              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>SUPERSONIC TIME</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
                  {attributes.supersonic_pct}%
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  Speed maintenance across car runtime
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>AERIAL TOUCHES</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#c084fc', marginTop: '4px' }}>
                  {attributes.total_aerial_touches}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.aerials_per_game} aerials per match
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>DEMOLITIONS DEALT</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#f87171', marginTop: '4px' }}>
                  {attributes.total_demos}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {attributes.demos_per_game} demos per match
                </div>
              </div>
            </>
          )}

          {/* Boost IQ */}
          {(activeCategory === 'all' || activeCategory === 'boost') && (
            <>
              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>AVERAGE BOOST HELD</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#34d399', marginTop: '4px' }}>
                  {attributes.avg_boost}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  Out of 100 capacity
                </div>
              </div>

              <div style={{ backgroundColor: '#141d2f', borderRadius: '12px', padding: '16px', border: '1px solid #1e2c47' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>BOOST STARVATION RATE</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: attributes.empty_boost_pct > 10 ? '#f87171' : '#f59e0b', marginTop: '4px' }}>
                  {attributes.empty_boost_pct}%
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  Time spent on 0 boost
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 4. Playlist Breakdown Table */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
          overflowX: 'hidden',
        }}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', marginBottom: '14px' }}>
          Game Mode & Playlist Breakdown
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1e2c47', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '12px 14px' }}>Playlist / Mode</th>
              <th style={{ padding: '12px 10px', textAlign: 'center' }}>Matches</th>
              <th style={{ padding: '12px 10px', textAlign: 'center' }}>Record</th>
              <th style={{ padding: '12px 10px', textAlign: 'center' }}>Win Rate</th>
              <th style={{ padding: '12px 10px', textAlign: 'center' }}>Avg Rating</th>
              <th style={{ padding: '12px 10px', textAlign: 'center' }}>Goals / Match</th>
            </tr>
          </thead>
          <tbody>
            {profile.playlists.map((pl, idx) => (
              <tr
                key={pl.playlist_id}
                style={{
                  borderBottom: '1px solid #141f33',
                  backgroundColor: idx % 2 === 0 ? '#0f1728' : 'transparent',
                }}
              >
                <td style={{ padding: '12px 14px', fontWeight: 800, color: '#f8fafc' }}>
                  {pl.playlist_name}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'center', color: '#94a3b8' }}>
                  {pl.matches}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'center', color: '#cbd5e1' }}>
                  {pl.wins}W - {pl.losses}L
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'center', fontWeight: 800, color: pl.win_rate >= 50 ? '#34d399' : '#f87171' }}>
                  {pl.win_rate}%
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                  <RatingBadge score={pl.avg_rating} size="sm" />
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'center', color: '#38bdf8', fontWeight: 700 }}>
                  {pl.goals_per_game}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. Bottom Archive Dropdown (Keeps Player List Off Main Page Until Opened) */}
      {onSelectPlayerProfile && squadPlayers.length > 0 && (
        <div
          className="surface-card"
          style={{
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Stored Profiles Archive
            </span>
            {!profile.is_user && (
              <button
                type="button"
                onClick={() => onSelectPlayerProfile(null)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  border: '1px solid var(--accent-win)',
                  backgroundColor: 'rgba(16, 185, 129, 0.14)',
                  color: 'var(--accent-win)',
                }}
              >
                ★ Back to My Profile
              </button>
            )}
          </div>

          <select
            aria-label="Stored Player Profiles"
            value={profile.is_user ? '' : profile.primary_id}
            onChange={e => {
              const val = e.target.value;
              onSelectPlayerProfile(val === '' ? null : val);
            }}
            style={{
              backgroundColor: 'var(--bg-subcard)',
              border: '1px solid var(--border-hairline)',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer',
              minWidth: '270px',
            }}
          >
            <option value="" style={{ backgroundColor: '#0f172a', color: '#cbd5e1' }}>
              {profile.is_user
                ? `Select saved player (${squadPlayers.length} stored)...`
                : '★ Return to My Profile'}
            </option>
            {squadPlayers.some(sp => sp.is_pinned_friend) && (
              <optgroup label="⭐ Pinned Squad Friends">
                {squadPlayers
                  .filter(sp => sp.is_pinned_friend)
                  .map(sp => (
                    <option key={sp.primary_id} value={sp.primary_id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>
                      {sp.name}{sp.matches_together ? ` (${sp.matches_together} matches)` : ''}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Lobby & Teammate Archive">
              {squadPlayers
                .filter(sp => !sp.is_pinned_friend)
                .map(sp => (
                  <option key={sp.primary_id} value={sp.primary_id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>
                    {sp.name}{sp.matches_together ? ` (${sp.matches_together} matches)` : ''}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
      )}
    </div>
  );
};
