import React, { useState, useEffect } from 'react';
import type { SquadFriendStats, DuoFriendDossier, TrioSquadDossier } from '../../shared/types.ts';
import { formatArenaName } from '../../shared/formatters.ts';
import { RadarChart } from '../components/RadarChart.tsx';
import { RatingBadge } from '../components/RatingBadge.tsx';
import { RotationBadge } from '../components/RotationBadge.tsx';
import { TrioSquadDossierView } from '../components/TrioSquadDossierView.tsx';
import { SquadMatchesExplorerView } from '../components/SquadMatchesExplorerView.tsx';
import { PairChemistryLab } from '../components/PairChemistryLab.tsx';
import { FifaCard } from '../components/FifaCard.tsx';

interface FriendItem {
  primary_id: string;
  name: string;
  source: string;
}

interface SquadHubProps {
  onSelectFriend?: (name: string) => void;
  onSelectMatch?: (guid: string) => void;
  onOpenProfile?: (primaryId: string) => void;
  initialFriendId?: string | null;
}

export const SquadHubView: React.FC<SquadHubProps> = ({ onSelectMatch, onOpenProfile, initialFriendId = null }) => {
  const [squadTab, setSquadTab] = useState<'trio' | 'chemistry' | 'matches' | 'duos'>('trio');
  const [friends, setFriends] = useState<SquadFriendStats[]>([]);
  const [allFriends, setAllFriends] = useState<FriendItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [trioDossier, setTrioDossier] = useState<TrioSquadDossier | null>(null);
  const [loadingTrio, setLoadingTrio] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'pinned' | 'high_syn' | 'high_dc' | 'winners' | 'frequent'>('pinned');
  const [cardModeFilter, setCardModeFilter] = useState<'all' | '2s' | '3s'>('all');
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(initialFriendId);
  const [dossier, setDossier] = useState<DuoFriendDossier | null>(null);
  const [loadingDossier, setLoadingDossier] = useState<boolean>(false);

  const loadFriends = () => {
    fetch('/api/squad/friends')
      .then(res => res.json())
      .then((data: SquadFriendStats[]) => {
        setFriends(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load squad friends:', err);
        setLoading(false);
      });
  };

  const loadAllFriends = () => {
    fetch('/api/friends')
      .then(res => res.json())
      .then((data: FriendItem[]) => {
        setAllFriends(Array.isArray(data) ? data : []);
      })
      .catch(err => {
        console.error('Failed to load all friends list:', err);
      });
  };

  const loadTrio = () => {
    fetch('/api/squad/trio')
      .then(res => res.json())
      .then((data: TrioSquadDossier) => {
        setTrioDossier(data);
        setLoadingTrio(false);
      })
      .catch(err => {
        console.error('Failed to load 3s trio dossier:', err);
        setLoadingTrio(false);
      });
  };

  useEffect(() => {
    loadFriends();
    loadAllFriends();
    loadTrio();
  }, []);

  useEffect(() => {
    if (selectedFriendId) {
      setLoadingDossier(true);
      fetch(`/api/squad/friend/${encodeURIComponent(selectedFriendId)}`)
        .then(res => res.json())
        .then((data: DuoFriendDossier) => {
          setDossier(data);
          setLoadingDossier(false);
        })
        .catch(err => {
          console.error('Failed to load duo dossier:', err);
          setLoadingDossier(false);
        });
    } else {
      setDossier(null);
    }
  }, [selectedFriendId]);

  const togglePinFriend = async (primaryId: string, name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch('/api/friends/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: primaryId, name }),
      }).then(r => r.json());

      // Update local state
      setFriends(prev =>
        prev.map(f => (f.primary_id === primaryId ? { ...f, is_pinned_friend: res.is_pinned } : f))
      );
      if (dossier && dossier.primary_id === primaryId) {
        setDossier({ ...dossier, is_pinned_friend: res.is_pinned });
      }
    } catch (err) {
      console.error('Failed to toggle friend pin:', err);
    }
  };

  const filteredFriends = friends
    .filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(f => {
      if (activeFilter === 'pinned') return f.is_pinned_friend;
      if (activeFilter === 'high_syn') return f.chemistry_score >= 60;
      if (activeFilter === 'high_dc') return f.double_commits_per_game >= 0.60;
      if (activeFilter === 'winners') return f.win_rate >= 50;
      if (activeFilter === 'frequent') return f.matches_together >= 3;
      return true;
    });

  // 1. Render Dossier View if a friend is selected
  if (selectedFriendId) {
    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Navigation Bar Back */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => setSelectedFriendId(null)}
            style={{
              backgroundColor: '#141d2f',
              border: '1px solid #233252',
              color: '#38bdf8',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ← Back to Squad Cards
          </button>
        </div>

        {loadingDossier ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>Analyzing Full Mutual Match History & Collision Telemetry...</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>Correlating touches, assists, and rotations</div>
          </div>
        ) : !dossier ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
            Dossier not found for this partner.
          </div>
        ) : (
          <>
            {/* Dossier Hero Header */}
            <div
              className="surface-card"
              style={{
                borderColor: dossier.is_pinned_friend ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-hairline)',
                padding: '28px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div
                    style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '26px',
                      fontWeight: 900,
                      color: '#ffffff',
                      boxShadow: '0 4px 16px rgba(56, 189, 248, 0.35)',
                    }}
                  >
                    {dossier.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#f8fafc', margin: 0 }}>
                        {dossier.name}
                      </h2>
                      <button
                        onClick={e => togglePinFriend(dossier.primary_id, dossier.name, e)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '3px 10px',
                          borderRadius: '20px',
                          border: dossier.is_pinned_friend ? '1px solid #10b981' : '1px solid #475569',
                          backgroundColor: dossier.is_pinned_friend ? '#065f46' : '#1e293b',
                          color: dossier.is_pinned_friend ? '#34d399' : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {dossier.is_pinned_friend ? '⭐ PINNED FRIEND' : '☆ PIN AS FRIEND'}
                      </button>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '3px 10px',
                          borderRadius: '20px',
                          backgroundColor: '#172554',
                          border: '1px solid #3b82f6',
                          color: '#60a5fa',
                        }}
                      >
                        {dossier.matches_together} Matches Together
                      </span>
                      {onOpenProfile && (
                        <button
                          onClick={() => onOpenProfile(dossier.primary_id)}
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            padding: '4px 12px',
                            borderRadius: '20px',
                            border: '1px solid rgba(56, 189, 248, 0.45)',
                            backgroundColor: 'rgba(56, 189, 248, 0.14)',
                            color: '#38bdf8',
                            cursor: 'pointer',
                          }}
                        >
                          👤 Full Career Profile & Attributes →
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
                      Platform ID: <code style={{ color: '#cbd5e1' }}>{dossier.primary_id}</code>
                    </div>
                  </div>
                </div>

                {/* Quick Chemistry Pill */}
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 900,
                      color: dossier.chemistry_score >= 70 ? '#34d399' : '#fb923c',
                    }}
                  >
                    {dossier.chemistry_score} <span style={{ fontSize: '13px', color: '#94a3b8' }}>/ 100 SYN</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Duo Chemistry Index</div>
                </div>
              </div>

              {/* Four KPI Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '24px' }}>
                {/* 1. Record & Goal Diff */}
                <div style={{ backgroundColor: '#141d2f', padding: '16px', borderRadius: '12px', border: '1px solid #1e2c47' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>DUO RECORD</div>
                  <div style={{ fontSize: '24px', fontWeight: 900, color: dossier.win_rate >= 50 ? '#34d399' : '#f87171', marginTop: '4px' }}>
                    {dossier.win_rate}%
                  </div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>
                    {dossier.wins}W - {dossier.losses}L (Goal Diff: <strong style={{ color: dossier.goal_differential >= 0 ? '#34d399' : '#f87171' }}>{dossier.goal_differential >= 0 ? `+${dossier.goal_differential}` : dossier.goal_differential}</strong>)
                  </div>
                </div>

                {/* 2. Passing Connections */}
                <div style={{ backgroundColor: '#141d2f', padding: '16px', borderRadius: '12px', border: '1px solid #1e2c47' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>PASSING CONNECTION</div>
                  <div style={{ fontSize: '24px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
                    {dossier.friend_assists_to_user + dossier.user_assists_to_friend} <span style={{ fontSize: '14px', color: '#94a3b8' }}>assists</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>
                    Direct connection: <strong>{dossier.passing_connection_rate ?? 0}%</strong> of goals assisted
                  </div>
                </div>

                {/* 3. Double Commit & Encroachment Index */}
                <div style={{ backgroundColor: '#141d2f', padding: '16px', borderRadius: '12px', border: '1px solid #1e2c47' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>MUTUAL TAILING</div>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: dossier.rotational_risk === 'Low' ? '#065f46' : dossier.rotational_risk === 'Moderate' ? '#451a03' : '#7f1d1d',
                        color: dossier.rotational_risk === 'Low' ? '#34d399' : dossier.rotational_risk === 'Moderate' ? '#fcd34d' : '#fca5a5',
                      }}
                    >
                      {dossier.rotational_risk} Risk
                    </span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 900, color: dossier.double_commits_per_game >= 0.70 ? '#f87171' : '#f59e0b', marginTop: '4px' }}>
                    {dossier.double_commits_per_game} <span style={{ fontSize: '14px', color: '#94a3b8' }}>/ game</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>
                    You encroached: <strong>{dossier.user_encroachments ?? 0}</strong> | They encroached: <strong>{dossier.friend_encroachments ?? 0}</strong>
                  </div>
                </div>

                {/* 4. Defensive Third-Man Coverage */}
                <div style={{ backgroundColor: '#141d2f', padding: '16px', borderRadius: '12px', border: '1px solid #1e2c47' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>DEFENSIVE COVERAGE</div>
                  <div style={{ fontSize: '24px', fontWeight: 900, color: (dossier.third_man_coverage_pct ?? 75) >= 70 ? '#34d399' : '#fb923c', marginTop: '4px' }}>
                    {dossier.third_man_coverage_pct ?? 75}%
                  </div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>
                    Rotational safety factor during offensive transitions
                  </div>
                </div>
              </div>

              {/* Mode Breakdown Strip (2s vs 3s) */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', backgroundColor: '#141d2f', border: '1px solid #312e81' }}>
                  <span style={{ fontSize: '14px' }}>⚔️</span>
                  <span style={{ fontSize: '12px', color: '#a5b4fc', fontWeight: 800 }}>2v2 Doubles Record:</span>
                  <span style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 700 }}>
                    {dossier.matches_2s ?? 0} games (
                    {dossier.matches_2s ? `${Math.round(((dossier.wins_2s ?? 0) / dossier.matches_2s) * 1000) / 10}% win rate` : 'None yet'}
                    )
                  </span>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', backgroundColor: '#141d2f', border: '1px solid #0369a1' }}>
                  <span style={{ fontSize: '14px' }}>🛡️</span>
                  <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 800 }}>3v3 Standard Record:</span>
                  <span style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 700 }}>
                    {dossier.matches_3s ?? 0} games (
                    {dossier.matches_3s ? `${Math.round(((dossier.wins_3s ?? 0) / dossier.matches_3s) * 1000) / 10}% win rate` : 'None yet'}
                    )
                  </span>
                </div>
              </div>

              {/* Synergy Insights List */}
              <div style={{ marginTop: '20px', padding: '14px 18px', borderRadius: '10px', backgroundColor: '#0f172a', border: '1px solid #1e293b' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8', marginBottom: '6px' }}>
                  🧠 TACTICAL SYNERGY INSIGHTS & VERDICT
                </div>
                <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5, marginBottom: '8px' }}>
                  {dossier.chemistry_verdict}
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
                  {dossier.synergy_insights.map((insight, idx) => (
                    <li key={idx}>{insight}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Side-by-Side Tactical Radars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              <RadarChart radar={dossier.user_radar} playerName="Your Tactical Radar (with Partner)" size={320} />
              <RadarChart radar={dossier.friend_radar} playerName={`${dossier.name}'s Tactical Radar`} size={320} />
            </div>

            {/* Complete Match History Table */}
            <div
              className="surface-card"
              style={{
                padding: '24px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    Mutual Match History ({dossier.matches.length} Games)
                  </h3>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
                    Click any match to inspect detailed replay analysis & shot maps in Match Center
                  </p>
                </div>
              </div>

              {/* Match Table Container - Responsive without horizontal scroll */}
              <div
                style={{
                  width: '100%',
                  overflowX: 'hidden',
                  borderRadius: '10px',
                  border: '1px solid #1a253c',
                  backgroundColor: '#0c1322',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #1e2c47', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Match</th>
                      <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Arena & Date</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', color: '#38bdf8', whiteSpace: 'nowrap' }}>You</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', color: '#34d399', whiteSpace: 'nowrap' }}>{dossier.name}</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>Defense / DC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.matches.map(m => (
                      <tr
                        key={m.guid}
                        onClick={() => onSelectMatch && onSelectMatch(m.guid)}
                        style={{
                          borderBottom: '1px solid #141f33',
                          cursor: onSelectMatch ? 'pointer' : 'default',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#162238')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: m.is_win ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: m.is_win ? '#34d399' : '#f87171',
                                border: m.is_win ? '1px solid #10b981' : '1px solid #ef4444',
                              }}
                            >
                              {m.is_win ? 'WIN' : 'LOSS'}
                            </span>
                            <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '12px' }}>
                              {m.score_user} - {m.score_opp}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '4px',
                                backgroundColor: m.mode === '2v2 Doubles' ? '#1e1b4b' : '#082f49',
                                color: m.mode === '2v2 Doubles' ? '#a5b4fc' : '#38bdf8',
                              }}
                            >
                              {m.mode === '2v2 Doubles' ? '2v2' : '3v3'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                            {formatArenaName(m.arena)}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>
                            {new Date(m.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                            {new Date(m.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <RatingBadge score={m.user_rating} size="sm" />
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {m.user_goals}G
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <RatingBadge score={m.friend_rating} size="sm" />
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {m.friend_goals}G
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <RotationBadge count={m.double_commits} elgCount={m.errors_leading_to_goal || 0} is2v2={m.mode === '2v2 Doubles'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // 2. Render View
  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Squad Mode Selector - Liquid Glass Pills */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '6px',
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
          alignSelf: 'flex-start',
        }}
      >
        <button
          onClick={() => { setSquadTab('trio'); setSelectedFriendId(null); }}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: squadTab === 'trio' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
            borderTop: squadTab === 'trio' ? '1px solid rgba(147, 197, 253, 0.65)' : '1px solid transparent',
            backgroundColor: squadTab === 'trio' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
            color: squadTab === 'trio' ? '#38bdf8' : '#94a3b8',
            boxShadow: squadTab === 'trio' ? '0 2px 10px rgba(56, 189, 248, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12)' : 'none',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
          }}
        >
          <span>🛡️</span> 3s Core Roster (Trio Dossier)
        </button>
        <button
          onClick={() => { setSquadTab('matches'); setSelectedFriendId(null); }}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: squadTab === 'matches' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
            borderTop: squadTab === 'matches' ? '1px solid rgba(147, 197, 253, 0.65)' : '1px solid transparent',
            backgroundColor: squadTab === 'matches' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
            color: squadTab === 'matches' ? '#38bdf8' : '#94a3b8',
            boxShadow: squadTab === 'matches' ? '0 2px 10px rgba(56, 189, 248, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12)' : 'none',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
          }}
        >
          <span>⚡</span> Squad Matches Explorer
        </button>
        <button
          onClick={() => { setSquadTab('duos'); setSelectedFriendId(null); }}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: squadTab === 'duos' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
            borderTop: squadTab === 'duos' ? '1px solid rgba(147, 197, 253, 0.65)' : '1px solid transparent',
            backgroundColor: squadTab === 'duos' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
            color: squadTab === 'duos' ? '#38bdf8' : '#94a3b8',
            boxShadow: squadTab === 'duos' ? '0 2px 10px rgba(56, 189, 248, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12)' : 'none',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
          }}
        >
          <span>👥</span> Partner Duo Cards ({friends.length})
        </button>
        <button
          onClick={() => { setSquadTab('chemistry'); setSelectedFriendId(null); }}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: squadTab === 'chemistry' ? '1px solid rgba(52, 211, 153, 0.35)' : '1px solid transparent',
            borderTop: squadTab === 'chemistry' ? '1px solid rgba(110, 231, 183, 0.65)' : '1px solid transparent',
            backgroundColor: squadTab === 'chemistry' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
            color: squadTab === 'chemistry' ? '#34d399' : '#94a3b8',
            boxShadow: squadTab === 'chemistry' ? '0 2px 10px rgba(16, 185, 129, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12)' : 'none',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
          }}
        >
          <span>🧪</span> Pair Chemistry Lab
        </button>
      </div>

      {squadTab === 'chemistry' ? (
        <PairChemistryLab onOpenProfile={onOpenProfile} />
      ) : squadTab === 'trio' ? (
        loadingTrio ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>Analyzing Full 3s Trio Roster Telemetry...</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>Correlating 34 matches between Swapo_o, Rocinante_., and Mechless Madness</div>
          </div>
        ) : trioDossier ? (
          <TrioSquadDossierView trio={trioDossier} onSelectMatch={onSelectMatch} onOpenProfile={onOpenProfile} />
        ) : (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>No 3s trio matches found.</div>
        )
      ) : squadTab === 'matches' ? (
        <SquadMatchesExplorerView
          onSelectMatch={onSelectMatch}
          availableFriends={allFriends}
          onFriendAdded={() => {
            loadFriends();
            loadAllFriends();
          }}
        />
      ) : (
        <>
          {/* 1. Header Banner */}
          <div
            className="surface-card-elevated"
            style={{
              padding: '28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '26px' }}>👥</span>
            <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#f8fafc', margin: 0, letterSpacing: '-0.02em' }}>
              Squad Hub & Friend Circle
            </h2>
          </div>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '6px 0 0 0' }}>
            Duo chemistry, win rates, and double-commit telemetry across all matches played with your teammates
          </p>
        </div>

        {/* Search Input & Quick Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
          <input
            type="text"
            placeholder="Search teammate..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              backgroundColor: '#141d2f',
              border: '1px solid #233252',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              color: '#ffffff',
              outline: 'none',
              width: '220px',
            }}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {/* Mode Filter for Partner FIFA Cards */}
            <div style={{ display: 'inline-flex', backgroundColor: '#0c121e', border: '1px solid #233252', borderRadius: '14px', padding: '2px', gap: '2px', marginRight: '6px' }}>
              {([
                { id: 'all', label: 'All Cards' },
                { id: '2s', label: '2v2 Cards' },
                { id: '3s', label: '3v3 Cards' },
              ] as const).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCardModeFilter(m.id)}
                  style={{
                    backgroundColor: cardModeFilter === m.id ? '#0284c7' : 'transparent',
                    color: cardModeFilter === m.id ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    padding: '3px 9px',
                    borderRadius: '12px',
                    fontSize: '10px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {[
              { id: 'all', label: 'All' },
              { id: 'pinned', label: '⭐ Friends Only' },
              { id: 'high_syn', label: '🔥 High Synergy' },
              { id: 'high_dc', label: '⚠️ High Commits' },
              { id: 'winners', label: '🏆 Win Rate > 50%' },
              { id: 'frequent', label: '🔁 Core (3+ Matches)' },
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setActiveFilter(pill.id as any)}
                style={{
                  backgroundColor: activeFilter === pill.id ? '#1e3a8a' : '#141d2f',
                  color: activeFilter === pill.id ? '#60a5fa' : '#94a3b8',
                  border: activeFilter === pill.id ? '1px solid #3b82f6' : '1px solid #233252',
                  padding: '4px 10px',
                  borderRadius: '14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>Correlating Teammate Telemetry & Double Commits...</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Reading raw event collision hits</div>
        </div>
      ) : filteredFriends.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          No friends or repeat teammates found matching your filter.
        </div>
      ) : (
        /* 2. Friends Cards Grid */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          {filteredFriends.map(friend => {
            const isHighDc = friend.double_commits_per_game >= 0.70;
            const isGoodChemistry = friend.chemistry_score >= 70;
            const displayedCard =
              cardModeFilter === '2s'
                ? friend.fifa_card_2s
                : cardModeFilter === '3s'
                ? friend.fifa_card_3s
                : friend.fifa_card;

            return (
              <div
                key={friend.primary_id}
                onClick={() => setSelectedFriendId(friend.primary_id)}
                className="surface-card"
                style={{
                  border: friend.is_pinned_friend
                    ? '2px solid #10b981'
                    : isGoodChemistry
                    ? '1px solid #10b981'
                    : isHighDc
                    ? '1px solid #b45309'
                    : '1px solid var(--border-hairline)',
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: friend.is_pinned_friend
                    ? '0 4px 20px rgba(16, 185, 129, 0.2)'
                    : isGoodChemistry
                    ? '0 4px 20px rgba(16, 185, 129, 0.12)'
                    : undefined,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div>
                  {/* Compact FIFA Ultimate Card Showcase when available */}
                  {displayedCard && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                      <FifaCard
                        card={displayedCard}
                        size="sm"
                        editable
                        showShare
                        showCycleBar
                        onCardUpdated={nextCard =>
                          setFriends(prev =>
                            prev.map(item =>
                              item.primary_id === friend.primary_id
                                ? {
                                    ...item,
                                    fifa_card: nextCard.mode === 'all' ? nextCard : item.fifa_card ? { ...item.fifa_card, car_body: nextCard.car_body, display_name: nextCard.display_name, card_title: nextCard.card_title } : item.fifa_card,
                                    fifa_card_2s: nextCard.mode === '2s' ? nextCard : item.fifa_card_2s ? { ...item.fifa_card_2s, car_body: nextCard.car_body, display_name: nextCard.display_name, card_title: nextCard.card_title } : item.fifa_card_2s,
                                    fifa_card_3s: nextCard.mode === '3s' ? nextCard : item.fifa_card_3s ? { ...item.fifa_card_3s, car_body: nextCard.car_body, display_name: nextCard.display_name, card_title: nextCard.card_title } : item.fifa_card_3s,
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </div>
                  )}

                  {/* Top Bar: Name & Chemistry Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          fontWeight: 900,
                          color: '#38bdf8',
                        }}
                      >
                        {friend.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                            {friend.name}
                          </h3>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {friend.matches_together} matches together
                        </div>
                      </div>
                    </div>

                    {/* Friend Pin Button & Chemistry Pill */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                      <button
                        onClick={e => togglePinFriend(friend.primary_id, friend.name, e)}
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          border: friend.is_pinned_friend ? '1px solid #10b981' : '1px solid #334155',
                          backgroundColor: friend.is_pinned_friend ? '#065f46' : '#1e293b',
                          color: friend.is_pinned_friend ? '#34d399' : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {friend.is_pinned_friend ? '⭐ FRIEND' : '☆ PIN'}
                      </button>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: isGoodChemistry ? '#065f46' : isHighDc ? '#451a03' : '#1e293b',
                          color: isGoodChemistry ? '#34d399' : isHighDc ? '#fb923c' : '#94a3b8',
                        }}
                      >
                        {friend.chemistry_score} SYN
                      </span>
                    </div>
                  </div>

                  {/* Core Metrics Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                    {/* Win Rate */}
                    <div style={{ backgroundColor: '#141d2f', padding: '10px 14px', borderRadius: '10px', border: '1px solid #1c2a44' }}>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800 }}>WIN RATE</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: friend.win_rate >= 50 ? '#34d399' : '#f87171', marginTop: '2px' }}>
                        {friend.win_rate}%
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {friend.wins}W - {friend.losses}L
                      </div>
                    </div>

                    {/* Double Commits */}
                    <div style={{ backgroundColor: '#141d2f', padding: '10px 14px', borderRadius: '10px', border: '1px solid #1c2a44' }}>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800 }}>DOUBLE COMMITS</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: isHighDc ? '#f87171' : '#f59e0b', marginTop: '2px' }}>
                        {friend.double_commits_per_game} <span style={{ fontSize: '11px', color: '#94a3b8' }}>/ game</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {friend.double_commits} total collisions
                      </div>
                    </div>
                  </div>

                  {/* Duo Chemistry Breakdown */}
                  <div style={{ backgroundColor: '#0f172a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e293b', marginBottom: '14px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#94a3b8' }}>Teammate Goals:</span>
                      <strong style={{ color: '#f8fafc' }}>{friend.teammate_goals}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#94a3b8' }}>Teammate Assists to You:</span>
                      <strong style={{ color: '#38bdf8' }}>{friend.teammate_assists}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>Your Goals with Partner:</span>
                      <strong style={{ color: '#34d399' }}>{friend.user_goals}</strong>
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      backgroundColor: isGoodChemistry ? 'rgba(16, 185, 129, 0.08)' : isHighDc ? 'rgba(239, 68, 68, 0.08)' : 'rgba(148, 163, 184, 0.08)',
                      borderLeft: isGoodChemistry ? '3px solid #10b981' : isHighDc ? '3px solid #ef4444' : '3px solid #64748b',
                      padding: '8px 12px',
                      borderRadius: '0 6px 6px 0',
                      fontSize: '11px',
                      color: '#e2e8f0',
                      lineHeight: 1.4,
                      marginBottom: '10px',
                    }}
                  >
                    {friend.chemistry_verdict}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
                      Inspect Duo Dossier ({friend.matches_together}m) →
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProfile?.(friend.primary_id);
                      }}
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#a78bfa',
                        backgroundColor: 'rgba(139, 92, 246, 0.14)',
                        border: '1px solid rgba(139, 92, 246, 0.4)',
                        borderRadius: '8px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      👤 Profile →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
};