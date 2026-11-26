import React, { useState, useEffect } from 'react';
import type { SquadExplorerMatch } from '../../shared/types.ts';
import { formatArenaName } from '../../shared/formatters.ts';
import { RatingBadge } from './RatingBadge.tsx';
import { RotationBadge } from './RotationBadge.tsx';

interface FriendItem {
  primary_id: string;
  name: string;
  source: string;
}

interface SquadMatchesExplorerViewProps {
  onSelectMatch?: (guid: string) => void;
  availableFriends: FriendItem[];
  onFriendAdded?: () => void;
}

export const SquadMatchesExplorerView: React.FC<SquadMatchesExplorerViewProps> = ({
  onSelectMatch,
  availableFriends,
  onFriendAdded,
}) => {
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [matchAll, setMatchAll] = useState<boolean>(false);
  const [modeFilter, setModeFilter] = useState<'all' | '2s' | '3s'>('all');
  const [matches, setMatches] = useState<SquadExplorerMatch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [newFriendInput, setNewFriendInput] = useState<string>('');
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [resultFilter, setResultFilter] = useState<'all' | 'wins' | 'losses'>('all');

  const fetchMatches = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedFriends.length > 0) {
      params.set('friends', selectedFriends.join(','));
    }
    if (matchAll) {
      params.set('match_all', 'true');
    }
    if (modeFilter !== 'all') {
      params.set('mode', modeFilter);
    }

    fetch(`/api/squad/matches?${params.toString()}`)
      .then(res => res.json())
      .then((data: SquadExplorerMatch[]) => {
        setMatches(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch squad explorer matches:', err);
        setMatches([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMatches();
  }, [selectedFriends, matchAll, modeFilter]);

  const toggleFriend = (name: string) => {
    setSelectedFriends(prev =>
      prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name]
    );
  };

  const handleAddCustomFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFriendInput.trim();
    if (!trimmed) return;

    setIsAdding(true);
    try {
      await fetch('/api/friends/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      setNewFriendInput('');
      if (onFriendAdded) onFriendAdded();
      // Auto-select the newly added friend
      if (!selectedFriends.includes(trimmed)) {
        setSelectedFriends(prev => [...prev, trimmed]);
      }
    } catch (err) {
      console.error('Failed to add custom friend:', err);
    } finally {
      setIsAdding(false);
    }
  };

  // Compute aggregate KPIs for the current filtered matches
  const totalMatches = matches.length;
  const wins = matches.filter(m => m.is_win).length;
  const losses = totalMatches - wins;
  const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 1000) / 10 : 0;
  const totalGoalsTeam = matches.reduce((acc, m) => acc + m.score_team, 0);
  const totalGoalsOpp = matches.reduce((acc, m) => acc + m.score_opp, 0);
  const goalDiff = totalGoalsTeam - totalGoalsOpp;
  const totalDoubleCommits = matches.reduce((acc, m) => acc + m.double_commits, 0);
  const dcPerGame = totalMatches > 0 ? Math.round((totalDoubleCommits / totalMatches) * 100) / 100 : 0;

  // MVP count
  const mvpCounts: Record<string, number> = {};
  for (const m of matches) {
    if (m.best_player) {
      mvpCounts[m.best_player] = (mvpCounts[m.best_player] || 0) + 1;
    }
  }
  const topMvp = Object.entries(mvpCounts).sort((a, b) => b[1] - a[1])[0];

  const filteredMatches = matches.filter(m => {
    if (resultFilter === 'wins') return m.is_win;
    if (resultFilter === 'losses') return !m.is_win;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Teammate Selection & Filter Header */}
      <div
        className="surface-card"
        style={{
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡</span> Teammate & Squad Combination Filter
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Select specific friends to view all matches played together in any 2s or 3s combination
            </div>
          </div>

          {/* Match Mode Toggle */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#0a0f1d',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              gap: '4px',
            }}
          >
            <button
              onClick={() => setMatchAll(false)}
              style={{
                backgroundColor: !matchAll ? '#1e3a8a' : 'transparent',
                color: !matchAll ? '#60a5fa' : '#94a3b8',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Match ANY Friend
            </button>
            <button
              onClick={() => setMatchAll(true)}
              style={{
                backgroundColor: matchAll ? '#1e3a8a' : 'transparent',
                color: matchAll ? '#60a5fa' : '#94a3b8',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Match ALL Selected (Exact Squad)
            </button>
          </div>
        </div>

        {/* Friend Selector Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setSelectedFriends([])}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: selectedFriends.length === 0 ? '1px solid #38bdf8' : '1px solid #334155',
              backgroundColor: selectedFriends.length === 0 ? 'rgba(56, 189, 248, 0.15)' : '#0f172a',
              color: selectedFriends.length === 0 ? '#38bdf8' : '#94a3b8',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ★ All Teammates
          </button>

          {availableFriends.map(friend => {
            const isSelected = selectedFriends.includes(friend.name);
            return (
              <button
                key={friend.primary_id || friend.name}
                onClick={() => toggleFriend(friend.name)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                  backgroundColor: isSelected ? '#0284c7' : '#0f172a',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{isSelected ? '✓' : '+'}</span>
                <span>{friend.name}</span>
                {friend.name.includes('RudeTurkey') && (
                  <span style={{ fontSize: '10px', color: isSelected ? '#e0f2fe' : '#94a3b8', fontWeight: 600 }}>
                    (Xbox: HulkingPen)
                  </span>
                )}
                {friend.source === 'custom' && (
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>★</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Game Mode / Playlist Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
          <span style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Mode:
          </span>
          <button
            onClick={() => setModeFilter('all')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              border: modeFilter === 'all' ? '1px solid #38bdf8' : '1px solid #233252',
              backgroundColor: modeFilter === 'all' ? '#1e3a8a' : '#0a0f1d',
              color: modeFilter === 'all' ? '#60a5fa' : '#94a3b8',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🎮 All Playlists
          </button>
          <button
            onClick={() => setModeFilter('2s')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              border: modeFilter === '2s' ? '1px solid #818cf8' : '1px solid #233252',
              backgroundColor: modeFilter === '2s' ? '#312e81' : '#0a0f1d',
              color: modeFilter === '2s' ? '#a5b4fc' : '#94a3b8',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>⚔️</span> 2v2 Duos (2s Only)
          </button>
          <button
            onClick={() => setModeFilter('3s')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              border: modeFilter === '3s' ? '1px solid #38bdf8' : '1px solid #233252',
              backgroundColor: modeFilter === '3s' ? '#0c4a6e' : '#0a0f1d',
              color: modeFilter === '3s' ? '#38bdf8' : '#94a3b8',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>🛡️</span> 3v3 Standard (3s Only)
          </button>
        </div>

        {/* Add Friend by Name Bar */}
        <form
          onSubmit={handleAddCustomFriend}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#0a0f1d',
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid #1e293b',
            maxWidth: '520px',
          }}
        >
          <span style={{ fontSize: '13px', color: '#64748b' }}>👤</span>
          <input
            type="text"
            value={newFriendInput}
            onChange={e => setNewFriendInput(e.target.value)}
            placeholder="Add teammate by name (e.g. RudeTurkey7373 / HulkingPen12238)..."
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: '12px',
              flex: 1,
            }}
          />
          <button
            type="submit"
            disabled={isAdding || !newFriendInput.trim()}
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: newFriendInput.trim() ? 'pointer' : 'not-allowed',
              opacity: newFriendInput.trim() ? 1 : 0.5,
              whiteSpace: 'nowrap',
            }}
          >
            {isAdding ? 'Adding...' : '+ Add Friend'}
          </button>
        </form>
      </div>

      {/* 2s Duos Mode Context Alert */}
      {modeFilter === '2s' && (
        <div
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid #4f46e5',
            borderRadius: '12px',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '12px',
            color: '#c7d2fe',
          }}
        >
          <span style={{ fontSize: '20px' }}>⚔️</span>
          <div>
            <strong>2v2 Duos Active:</strong> Displaying matches played as a 2-player team with your friend. In 2s, rotations have zero safety nets—any double commit immediately opens your net for counter-attack.
          </div>
        </div>
      )}

      {/* 2. Filtered Squad KPI Summary Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
        }}
      >
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Matches Found</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>{totalMatches}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            {selectedFriends.length === 0 ? 'All Squad Friends' : `${selectedFriends.join(' + ')}`}
          </div>
        </div>

        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Win Rate</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: winRate >= 50 ? '#34d399' : '#f87171', marginTop: '4px' }}>
            {winRate}%
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            {wins}W - {losses}L
          </div>
        </div>

        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Goal Differential</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: goalDiff >= 0 ? '#38bdf8' : '#fb923c', marginTop: '4px' }}>
            {goalDiff >= 0 ? `+${goalDiff}` : goalDiff}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            {totalGoalsTeam} GF vs {totalGoalsOpp} GA
          </div>
        </div>

        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Double Commits</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: dcPerGame > 0.8 ? '#fb923c' : '#34d399', marginTop: '4px' }}>
            {dcPerGame} <span style={{ fontSize: '12px', color: '#64748b' }}>/ game</span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            {totalDoubleCommits} total collisions
          </div>
        </div>

        {topMvp && (
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Top Performer</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#f59e0b', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              👑 {topMvp[0]}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              {topMvp[1]} MVP honours ({Math.round((topMvp[1] / (totalMatches || 1)) * 100)}%)
            </div>
          </div>
        )}
      </div>

      {/* 3. Matches Table */}
      <div
        className="surface-card"
        style={{
          padding: '24px',
        }}
      >
        {/* Pinned Card Toolbar: Never displaced by table scrolling */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Squad Match Log ({filteredMatches.length} Games)
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
              Click any match row to view detailed replay metrics, shot maps, and telemetry in Match Center
            </p>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {(['all', 'wins', 'losses'] as const).map(f => (
              <button
                key={f}
                onClick={() => setResultFilter(f)}
                style={{
                  backgroundColor: resultFilter === f ? '#1e3a8a' : '#0f172a',
                  color: resultFilter === f ? '#60a5fa' : '#94a3b8',
                  border: resultFilter === f ? '1px solid #3b82f6' : '1px solid #1e293b',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 0.15s ease',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '16px', fontWeight: 800 }}>Loading Squad Matches...</div>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚽</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>
              No matches found with this squad combination
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', maxWidth: '440px', margin: '6px auto 0' }}>
              {matchAll && selectedFriends.length > 1
                ? 'Try toggling "Match ANY Friend" above to see games played with individual teammates from this group.'
                : 'Matches played with newly added friends will appear here once telemetry is recorded.'}
            </div>
          </div>
        ) : (
          /* Responsive Table Container - Fits 100% without horizontal scrollbar */
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
                <tr style={{ borderBottom: '2px solid #1a253c', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Match</th>
                  <th style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>Arena & Date</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>MVP</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>Squad Stat Lines</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>Defense / DC</th>
                </tr>
              </thead>
              <tbody>
                {filteredMatches.map(m => (
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
                          {m.score_team} - {m.score_opp}
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
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: '#1e293b',
                          color: '#f59e0b',
                          border: '1px solid rgba(217, 119, 6, 0.5)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        👑 {m.best_player.slice(0, 8)}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {m.players.map(p => (
                          <div key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>
                              {p.name.slice(0, 4)}:
                            </span>
                            <RatingBadge score={p.rating} size="sm" />
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                              {p.goals}G {p.assists}A
                            </span>
                          </div>
                        ))}
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
        )}
      </div>
    </div>
  );
};
