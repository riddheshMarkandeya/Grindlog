import React, { useState, useEffect, useRef } from 'react';
import type { MatchAnalysisResult, SessionRecap, PlayerProfile } from '../shared/types.ts';
import { MatchCenter } from './pages/MatchCenter.tsx';
import { SessionRecapView } from './pages/SessionRecap.tsx';
import { PlayerProfileView } from './pages/PlayerProfile.tsx';
import { SquadHubView } from './pages/SquadHub.tsx';

type AppTheme = 'obsidian' | 'carbon' | 'rlcs' | 'turf';

interface MatchListItem {
  guid: string;
  started_at: number;
  score_team0: number;
  score_team1: number;
  arena: string | null;
}

interface QuickFriendItem {
  name: string;
  primary_id: string;
}

const THEME_OPTIONS: Array<{ id: AppTheme; label: string }> = [
  { id: 'obsidian', label: '🌌 Obsidian Pitch' },
  { id: 'carbon', label: '🖤 Midnight Carbon' },
  { id: 'rlcs', label: '🏆 RLCS Broadcast' },
  { id: 'turf', label: '🌿 Emerald Turf' },
];

export const App: React.FC = () => {
  const [view, setView] = useState<'match' | 'session' | 'profile' | 'squad'>('match');
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [selectedGuid, setSelectedGuid] = useState<string>('');
  const [currentMatch, setCurrentMatch] = useState<MatchAnalysisResult | null>(null);
  const [session, setSession] = useState<SessionRecap | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [liveConnected, setLiveConnected] = useState<boolean>(false);
  const [friendsOnly, setFriendsOnly] = useState<boolean>(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('overtime_theme') : null;
    return saved === 'carbon' || saved === 'rlcs' || saved === 'turf' ? saved : 'obsidian';
  });
  const [quickQuery, setQuickQuery] = useState<string>('');
  const [quickFriends, setQuickFriends] = useState<QuickFriendItem[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('overtime_theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch('/api/squad/friends')
      .then(r => r.json())
      .then(list => {
        if (Array.isArray(list)) {
          setQuickFriends(
            list
              .filter((f: any) => f.is_pinned_friend)
              .map((f: any) => ({ name: f.name, primary_id: f.primary_id }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Global keyboard shortcuts: [ / ] steps matches, / focuses search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '[' && matches.length > 0) {
        const idx = matches.findIndex(m => m.guid === selectedGuid);
        const nextIdx = idx < matches.length - 1 ? idx + 1 : 0;
        setSelectedGuid(matches[nextIdx].guid);
        setView('match');
      } else if (e.key === ']' && matches.length > 0) {
        const idx = matches.findIndex(m => m.guid === selectedGuid);
        const prevIdx = idx > 0 ? idx - 1 : matches.length - 1;
        setSelectedGuid(matches[prevIdx].guid);
        setView('match');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [matches, selectedGuid]);

  // 1. Fetch recent matches on mount or when friendsOnly filter changes
  useEffect(() => {
    const url = `/api/matches?limit=30${friendsOnly ? '&friends_only=true' : ''}`;
    fetch(url)
      .then(res => res.json())
      .then((data: MatchListItem[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setMatches(data);
          if (!data.some(m => m.guid === selectedGuid)) {
            setSelectedGuid(data[0].guid);
          }
        } else if (friendsOnly) {
          setMatches([]);
        }
      })
      .catch(err => console.error('Failed to load matches:', err));
  }, [friendsOnly]);

  useEffect(() => {
    // Listen to real-time SSE from OvertimeRL backend
    const sse = new EventSource('/api/events');
    sse.onopen = () => setLiveConnected(true);
    sse.onerror = () => setLiveConnected(false);
    sse.addEventListener('match_updated', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.guid) {
          // If the updated match is the currently viewed match, reload it
          if (payload.guid === selectedGuid) {
            loadMatch(payload.guid);
          }
          // Refresh matches list
          fetch('/api/matches?limit=25')
            .then(res => res.json())
            .then(data => setMatches(data));
        }
      } catch (err) {
        console.error('Failed to parse match_updated event:', err);
      }
    });

    return () => sse.close();
  }, []);

  // 2. Load match analysis whenever selectedGuid changes
  useEffect(() => {
    if (selectedGuid) {
      loadMatch(selectedGuid);
    }
  }, [selectedGuid]);

  // 3. Load session or profile whenever switching views
  useEffect(() => {
    if (view === 'session') {
      const url = `/api/session/latest${friendsOnly ? '?friends_only=true' : ''}`;
      fetch(url)
        .then(res => res.json())
        .then((data: SessionRecap) => setSession(data))
        .catch(err => console.error('Failed to load session:', err));
    } else if (view === 'profile') {
      loadProfile(selectedProfileId || undefined);
    }
  }, [view, selectedProfileId, friendsOnly]);

  const loadProfile = (primaryId?: string) => {
    setProfileLoading(true);
    const url = primaryId ? `/api/player/${encodeURIComponent(primaryId)}/profile` : '/api/player/profile';
    fetch(url)
      .then(res => res.json())
      .then((data: PlayerProfile) => {
        setProfile(data);
        setProfileLoading(false);
      })
      .catch(err => {
        console.error('Failed to load player profile:', err);
        setProfileLoading(false);
      });
  };

  const openPlayerProfile = (primaryId: string | null) => {
    setSelectedProfileId(primaryId);
    setView('profile');
  };

  const loadMatch = (guid: string) => {
    setLoading(true);
    fetch(`/api/match/${guid}`)
      .then(res => res.json())
      .then((data: MatchAnalysisResult) => {
        setCurrentMatch(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load match analysis:', err);
        setLoading(false);
      });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation Bar - Liquid Glass Header */}
      <header
        style={{
          backgroundColor: 'var(--bg-card-elevated)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border-hairline)',
          boxShadow: 'var(--shadow-card)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {/* Brand Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setView('match')}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#10b981',
                boxShadow: '0 0 12px #10b981',
              }}
            />
            <span style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.03em', color: '#ffffff' }}>
              OVERTIME<span style={{ color: '#10b981' }}>RL</span>
            </span>
          </div>

          {/* Navigation Tabs - Specular Glass Pills */}
          <nav style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'match', label: 'Match Center' },
                { id: 'session', label: 'Session Leaderboard' },
                { id: 'profile', label: 'Player Profile' },
                { id: 'squad', label: '👥 Squad Hub' },
              ] as const
            ).map(tab => {
              const isActive = view === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: '9px',
                    border: isActive ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                    borderTop: isActive ? '1px solid rgba(147, 197, 253, 0.65)' : '1px solid transparent',
                    backgroundColor: isActive ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                    color: isActive ? '#38bdf8' : '#94a3b8',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 2px 10px rgba(56, 189, 248, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Controls: Search, Theme, Friends Filter, Match Stepper & Live Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', position: 'relative' }}>
          {/* Quick Match / Friend Search */}
          <div style={{ position: 'relative' }}>
            <input
              ref={searchRef}
              type="text"
              value={quickQuery}
              onChange={e => setQuickQuery(e.target.value)}
              placeholder="Jump friend / match (/)"
              style={{
                backgroundColor: 'var(--bg-subcard)',
                border: '1px solid var(--border-hairline)',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '12px',
                color: '#f8fafc',
                outline: 'none',
                width: '165px',
              }}
            />
            {quickQuery.trim().length > 0 && (
              <div
                className="surface-card-elevated"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: '250px',
                  maxWidth: '320px',
                  padding: '8px',
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {quickFriends
                  .filter(f => f.name.toLowerCase().includes(quickQuery.trim().toLowerCase()))
                  .slice(0, 5)
                  .map(f => (
                    <button
                      key={f.primary_id}
                      onClick={() => {
                        setQuickQuery('');
                        openPlayerProfile(f.primary_id);
                      }}
                      style={{
                        textAlign: 'left',
                        backgroundColor: 'var(--bg-subcard)',
                        border: '1px solid var(--border-hairline)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        color: '#e2e8f0',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>👤 {f.name}</span>
                      <span style={{ color: 'var(--accent-primary)', fontSize: '11px' }}>Profile →</span>
                    </button>
                  ))}
                {matches
                  .filter(m => {
                    const q = quickQuery.trim().toLowerCase();
                    const dateStr = new Date(m.started_at).toLocaleDateString().toLowerCase();
                    const scoreStr = `${m.score_team0}-${m.score_team1}`;
                    return dateStr.includes(q) || scoreStr.includes(q) || (m.arena ?? '').toLowerCase().includes(q);
                  })
                  .slice(0, 4)
                  .map(m => (
                    <button
                      key={m.guid}
                      onClick={() => {
                        setQuickQuery('');
                        setSelectedGuid(m.guid);
                        setView('match');
                      }}
                      style={{
                        textAlign: 'left',
                        backgroundColor: 'var(--bg-subcard)',
                        border: '1px solid var(--border-hairline)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        color: '#cbd5e1',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>🏟️ {new Date(m.started_at).toLocaleDateString()} ({m.score_team0}-{m.score_team1})</span>
                      <span style={{ color: 'var(--accent-win)' }}>Load</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Theme Switcher */}
          <select
            aria-label="Theme Switcher"
            value={theme}
            onChange={e => setTheme(e.target.value as AppTheme)}
            style={{
              backgroundColor: 'var(--bg-subcard)',
              border: '1px solid var(--border-hairline)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#e2e8f0',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {THEME_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Previous / Next Match Stepper */}
          {matches.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                title="Newer match ( [ )"
                onClick={() => {
                  const idx = matches.findIndex(m => m.guid === selectedGuid);
                  if (idx > 0) {
                    setSelectedGuid(matches[idx - 1].guid);
                    setView('match');
                  }
                }}
                disabled={matches.findIndex(m => m.guid === selectedGuid) <= 0}
                style={{
                  backgroundColor: 'var(--bg-subcard)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: '7px',
                  padding: '5px 8px',
                  color: '#cbd5e1',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: matches.findIndex(m => m.guid === selectedGuid) <= 0 ? 'not-allowed' : 'pointer',
                  opacity: matches.findIndex(m => m.guid === selectedGuid) <= 0 ? 0.45 : 1,
                }}
              >
                ◀
              </button>
              <button
                title="Older match ( ] )"
                onClick={() => {
                  const idx = matches.findIndex(m => m.guid === selectedGuid);
                  if (idx >= 0 && idx + 1 < matches.length) {
                    setSelectedGuid(matches[idx + 1].guid);
                    setView('match');
                  }
                }}
                disabled={(() => {
                  const idx = matches.findIndex(m => m.guid === selectedGuid);
                  return idx < 0 || idx + 1 >= matches.length;
                })()}
                style={{
                  backgroundColor: 'var(--bg-subcard)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: '7px',
                  padding: '5px 8px',
                  color: '#cbd5e1',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: (() => {
                    const idx = matches.findIndex(m => m.guid === selectedGuid);
                    return idx < 0 || idx + 1 >= matches.length ? 'not-allowed' : 'pointer';
                  })(),
                  opacity: (() => {
                    const idx = matches.findIndex(m => m.guid === selectedGuid);
                    return idx < 0 || idx + 1 >= matches.length ? 0.45 : 1;
                  })(),
                }}
              >
                ▶
              </button>
            </div>
          )}

          {/* Friends-Only Filter Toggle */}
          <button
            onClick={() => setFriendsOnly(!friendsOnly)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: friendsOnly ? 'rgba(16, 185, 129, 0.16)' : 'rgba(255, 255, 255, 0.05)',
              color: friendsOnly ? '#34d399' : '#94a3b8',
              border: friendsOnly ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(255, 255, 255, 0.1)',
              borderTop: friendsOnly ? '1px solid rgba(52, 211, 153, 0.7)' : '1px solid rgba(255, 255, 255, 0.22)',
              borderRadius: '9px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: friendsOnly
                ? '0 2px 12px rgba(16, 185, 129, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
                : '0 2px 6px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
              transition: 'all 0.15s ease',
            }}
            title="Toggle: Filter all data to only matches played with your friends"
          >
            <span>{friendsOnly ? '⭐' : '👥'}</span>
            <span>{friendsOnly ? 'Friends Only (Active)' : 'All Matches'}</span>
          </button>

          {/* Match Dropdown */}
          {matches.length > 0 && (
            <select
              value={selectedGuid}
              onChange={e => {
                setSelectedGuid(e.target.value);
                setView('match');
              }}
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderTop: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '9px',
                padding: '7px 12px',
                fontSize: '13px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '260px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
              }}
            >
              {matches.map(m => (
                <option key={m.guid} value={m.guid}>
                  {new Date(m.started_at).toLocaleDateString()} {new Date(m.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({m.score_team0}-{m.score_team1})
                </option>
              ))}
            </select>
          )}

          {/* Live Status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#141d2f',
              padding: '4px 10px',
              borderRadius: '20px',
              border: '1px solid #1c2a44',
              fontSize: '11px',
              fontWeight: 700,
              color: liveConnected ? '#34d399' : '#94a3b8',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: liveConnected ? '#10b981' : '#64748b',
              }}
            />
            {liveConnected ? 'Grindlog Live' : 'Grindlog Standby'}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '24px 16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '20px', fontWeight: 800 }}>Analyzing Telemetry & Generating FotMob Cards...</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>Reading tracker.db and correlating raw ticks</div>
          </div>
        ) : view === 'match' ? (
          currentMatch ? (
            <MatchCenter
              match={currentMatch}
              onRefresh={() => loadMatch(selectedGuid)}
              onOpenProfile={openPlayerProfile}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Select a match to inspect.</div>
          )
        ) : view === 'session' ? (
          session ? (
            <SessionRecapView
              session={session}
              onSelectMatch={guid => {
                setSelectedGuid(guid);
                setView('match');
              }}
              onOpenProfile={openPlayerProfile}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Loading session recap...</div>
          )
        ) : view === 'profile' ? (
          profileLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Loading player profile & tactical rules...</div>
          ) : profile ? (
            <PlayerProfileView
              profile={profile}
              onSelectMatch={guid => {
                setSelectedGuid(guid);
                setView('match');
              }}
              onSelectPlayerProfile={openPlayerProfile}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Player profile unavailable.</div>
          )
        ) : (
          <SquadHubView
            onSelectMatch={guid => {
              setSelectedGuid(guid);
              setView('match');
            }}
            onOpenProfile={openPlayerProfile}
          />
        )}
      </main>
    </div>
  );
};
