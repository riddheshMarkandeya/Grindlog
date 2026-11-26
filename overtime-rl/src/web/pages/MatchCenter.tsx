import React, { useState, useEffect } from 'react';
import type { MatchAnalysisResult, MatchPlayerAnalysis } from '../../shared/types.ts';
import { getMatchPlaylistLabel, formatArenaName } from '../../shared/formatters.ts';
import { getPlayerMatchTitles } from '../../shared/awards.ts';
import { RatingBadge } from '../components/RatingBadge.tsx';
import { RatingModal } from '../components/RatingModal.tsx';
import { MomentumGraph } from '../components/MomentumGraph.tsx';
import { TaleOfTape } from '../components/TaleOfTape.tsx';
import { RadarChart, DualRadarChart } from '../components/RadarChart.tsx';
import { OvrBadge } from '../components/OvrBadge.tsx';
import { DiscordExport } from '../components/DiscordExport.tsx';
import { CoachReportCard } from '../components/CoachReportCard.tsx';
import { DetailedStatsTable } from '../components/DetailedStatsTable.tsx';
import { PitchVisualizer } from '../components/PitchVisualizer.tsx';

interface MatchCenterProps {
  match: MatchAnalysisResult;
  onRefresh?: () => void;
  onOpenProfile?: (primaryId: string) => void;
}

export const MatchCenter: React.FC<MatchCenterProps> = ({ match, onOpenProfile }) => {
  const [activeTab, setActiveTab] = useState<'lineups' | 'coach' | 'stats' | 'pitch' | 'compare'>('lineups');
  const [selectedPlayer, setSelectedPlayer] = useState<MatchPlayerAnalysis | null>(null);
  const [activePlayTimeSec, setActivePlayTimeSec] = useState<number | null>(null);
  const [radarPlayerA, setRadarPlayerA] = useState<string>('');
  const [radarPlayerB, setRadarPlayerB] = useState<string>('');
  const [showAllRadars, setShowAllRadars] = useState<boolean>(false);

  const bluePlayers = match.players.filter(p => p.team_num === 0);
  const orangePlayers = match.players.filter(p => p.team_num === 1);

  const userPlayer = match.players.find(p => p.is_user || p.name === 'Swapo_o');
  const userTeamNum = match.user_team_num ?? (userPlayer ? userPlayer.team_num : null);

  useEffect(() => {
    setActivePlayTimeSec(null);
    const firstKey = userPlayer?.player_key || match.players[0]?.player_key || '';
    const oppSorted = [...match.players]
      .filter(p => p.player_key !== firstKey)
      .sort((a, b) => (a.team_num !== userTeamNum ? -1 : 1) || b.rating - a.rating);
    setRadarPlayerA(firstKey);
    setRadarPlayerB(oppSorted[0]?.player_key || firstKey);
  }, [match.guid]);

  const isUserOnBlue = userTeamNum === 0;
  const isUserOnOrange = userTeamNum === 1;
  const hasUserTeam = isUserOnBlue || isUserOnOrange;
  const isUserWin = hasUserTeam && match.winner_team_num !== null && match.winner_team_num === userTeamNum;

  const blueTeamTitle = isUserOnBlue ? 'YOUR TEAM' : isUserOnOrange ? 'OPPONENTS' : 'Blue Team';
  const orangeTeamTitle = isUserOnOrange ? 'YOUR TEAM' : isUserOnBlue ? 'OPPONENTS' : 'Orange Team';

  const renderPlayerCard = (p: MatchPlayerAnalysis, accentColor: string, userTintBg: string, userTintBorder: string, userTintTop: string) => {
    const playerTitles = getPlayerMatchTitles(p.name, match.awards).filter(t => !t.isNegative);
    return (
      <div
        key={p.player_key}
        onClick={() => setSelectedPlayer(p)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedPlayer(p);
          }
        }}
        title="Click to view match titles, tactical attributes & rating breakdown"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          backgroundColor: p.is_user ? userTintBg : 'rgba(255, 255, 255, 0.03)',
          borderRadius: '10px',
          border: p.is_user ? userTintBorder : '1px solid rgba(255, 255, 255, 0.05)',
          borderTop: p.is_user ? userTintTop : '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: p.is_user ? '0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)' : 'none',
          cursor: 'pointer',
          transition: 'background-color 0.15s ease, transform 0.12s ease',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: p.is_user ? accentColor : '#f8fafc' }}>
              {p.name} {p.is_user && '(You)'}
            </span>
            {playerTitles.length > 0 && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(250, 204, 21, 0.12)',
                  color: '#facc15',
                  border: '1px solid rgba(250, 204, 21, 0.35)',
                }}
                title={`${playerTitles.map(t => t.title).join(', ')} — Click player to view`}
              >
                🏅 {playerTitles.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{p.goals}G {p.assists}A {p.saves}S | xG: {p.xg} | {p.radar.archetype} •</span>
            <OvrBadge radar={p.radar} variant="inline" />
          </div>
        </div>
        <RatingBadge
          score={p.rating}
          size="md"
          onClick={() => setSelectedPlayer(p)}
          showDetailsHint
        />
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. FotMob Match Header - Elevated Liquid Glass */}
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
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: '#cbd5e1',
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {formatArenaName(match.arena)}
            </span>
            {match.overtime && (
              <span
                style={{
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: '6px',
                }}
              >
                OVERTIME
              </span>
            )}
          </div>
          <DiscordExport match={match} />
        </div>

        {/* Match Result Banner */}
        {hasUserTeam && (
          <div
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: isUserWin ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: isUserWin ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 900,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  backgroundColor: isUserWin ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: isUserWin ? '#34d399' : '#f87171',
                  border: isUserWin ? '1px solid #10b981' : '1px solid #ef4444',
                }}
              >
                {isUserWin ? '🏆 VICTORY' : '💀 DEFEAT'}
              </span>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                {getMatchPlaylistLabel(match.playlist_id, match.players.length)} • {match.overtime ? 'Overtime' : 'Regulation 5:00'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {new Date(match.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          </div>
        )}

        {/* Big Scoreboard */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px' }}>
          {/* Blue Team */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                color: '#ffffff',
                boxShadow: '0 4px 14px rgba(56, 189, 248, 0.4)',
              }}
            >
              🛡️
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#f8fafc' }}>{blueTeamTitle}</h2>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: isUserOnBlue ? '#065f46' : '#1e293b',
                    color: isUserOnBlue ? '#34d399' : '#38bdf8',
                    border: isUserOnBlue ? '1px solid #10b981' : '1px solid #0284c7',
                  }}
                >
                  {isUserOnBlue ? '★ YOU (BLUE)' : 'BLUE'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                Team Rating: <strong style={{ color: '#38bdf8' }}>{match.team0_rating.toFixed(1)}</strong> | xG:{' '}
                <strong style={{ color: '#10b981' }}>{match.team0_xg.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* Center Score */}
          <div style={{ textAlign: 'center', minWidth: '160px' }}>
            <div style={{ fontSize: '56px', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: '#ffffff' }}>
              {match.score_team0} <span style={{ color: '#475569', fontSize: '42px' }}>-</span> {match.score_team1}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
              {match.overtime ? 'Overtime' : 'Regulation 5:00'}
            </div>
          </div>

          {/* Orange Team */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, justifyContent: 'flex-end', textAlign: 'right' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: isUserOnOrange ? '#065f46' : 'rgba(255, 255, 255, 0.05)',
                    color: isUserOnOrange ? '#34d399' : '#94a3b8',
                    border: isUserOnOrange ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  {isUserOnOrange ? '★ YOU (ORANGE)' : 'ORANGE'}
                </span>
                <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#f8fafc' }}>{orangeTeamTitle}</h2>
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                Team Rating: <strong style={{ color: isUserOnOrange ? '#fb923c' : '#cbd5e1' }}>{match.team1_rating.toFixed(1)}</strong> | xG:{' '}
                <strong style={{ color: '#10b981' }}>{match.team1_xg.toFixed(2)}</strong>
              </div>
            </div>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #ea580c, #fb923c)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                color: '#ffffff',
                boxShadow: '0 4px 14px rgba(251, 146, 60, 0.4)',
              }}
            >
              🛡️
            </div>
          </div>
        </div>

        {/* Uncluttered Match Spotlight Bar */}
        <div
          style={{
            marginTop: '18px',
            paddingTop: '14px',
            borderTop: '1px solid #1a273e',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {match.awards.player_of_the_match && (() => {
              const potmPlayer = match.players.find(pl => pl.name === match.awards.player_of_the_match) || null;
              return (
                <button
                  onClick={() => potmPlayer && setSelectedPlayer(potmPlayer)}
                  style={{
                    backgroundColor: '#17283c',
                    border: '1px solid #10b981',
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#34d399',
                    cursor: potmPlayer ? 'pointer' : 'default',
                  }}
                >
                  ⭐ Player of the Match: {match.awards.player_of_the_match}
                </button>
              );
            })()}
            {userPlayer && (() => {
              const myTitles = getPlayerMatchTitles(userPlayer.name, match.awards).filter(t => !t.isNegative);
              if (myTitles.length === 0) return null;
              return (
                <button
                  onClick={() => setSelectedPlayer(userPlayer)}
                  style={{
                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#38bdf8',
                    cursor: 'pointer',
                  }}
                >
                  🏅 Your Titles ({myTitles.length}) • View Dossier
                </button>
              );
            })()}
          </div>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
            Click any player below to inspect earned titles, attributes & rating
          </span>
        </div>
      </div>

      {/* 2. Synced SofaScore Momentum Wave */}
      <MomentumGraph
        points={match.momentum}
        team0Name={isUserOnBlue ? 'Your Team (Blue)' : isUserOnOrange ? 'Opponents (Blue)' : 'Blue Team'}
        team1Name={isUserOnOrange ? 'Your Team (Orange)' : isUserOnBlue ? 'Opponents (Orange)' : 'Orange Team'}
        isUserOnTeam0={isUserOnBlue}
        isUserOnTeam1={isUserOnOrange}
        doubleCommits={match.double_commits}
        activeTimeSec={activeTab === 'pitch' ? activePlayTimeSec : null}
        onSelectTimeSec={sec => {
          setActivePlayTimeSec(sec);
          setActiveTab('pitch');
        }}
      />

      {/* 3. Navigation Tabs (Streamlined 5 Tabs) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border-hairline)', gap: '4px' }}>
        {[
          { id: 'lineups', label: 'Lineups & Ratings' },
          { id: 'coach', label: '🎯 Match Diagnostics' },
          { id: 'stats', label: '📊 Detailed Stats' },
          { id: 'pitch', label: `🗺️ 2D Pitch & xG (${match.shots.length + match.double_commits.length})` },
          { id: 'compare', label: '⚔️ Tape & Radars' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 700,
              color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '3px solid var(--accent-cyan)' : '3px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 4. Tab Content */}
      {activeTab === 'coach' && (
        <CoachReportCard
          report={match.user_coach_report}
          doubleCommits={match.double_commits}
          concededGoalChains={match.conceded_goal_chains ?? []}
        />
      )}

      {activeTab === 'stats' && <DetailedStatsTable players={match.players} onSelectPlayer={setSelectedPlayer} />}

      {activeTab === 'lineups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Blue Lineup Card - Liquid Glass */}
            <div
              className="surface-card"
              style={{
                borderColor: isUserOnBlue ? 'rgba(56, 189, 248, 0.45)' : 'var(--border-hairline)',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: 800, color: isUserOnBlue ? '#38bdf8' : 'var(--text-secondary)' }}>
                    {isUserOnBlue ? 'Your Team Lineup' : isUserOnOrange ? 'Opponents Lineup' : 'Blue Lineup'}
                  </h4>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      backgroundColor: isUserOnBlue ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color: isUserOnBlue ? '#38bdf8' : 'var(--text-muted)',
                      border: isUserOnBlue ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border-hairline)',
                    }}
                  >
                    BLUE
                  </span>
                </div>
                {isUserOnBlue && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#34d399',
                      border: '1px solid #10b981',
                    }}
                  >
                    ★ YOUR SQUAD
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {bluePlayers.map(p =>
                  renderPlayerCard(
                    p,
                    '#38bdf8',
                    'rgba(56, 189, 248, 0.09)',
                    '1px solid rgba(56, 189, 248, 0.28)',
                    '1px solid rgba(147, 197, 253, 0.5)'
                  )
                )}
              </div>
            </div>

            {/* Orange Lineup Card - Liquid Glass */}
            <div
              className="surface-card"
              style={{
                borderColor: isUserOnOrange ? 'rgba(251, 146, 60, 0.45)' : 'var(--border-hairline)',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: 800, color: isUserOnOrange ? '#fb923c' : 'var(--text-secondary)' }}>
                    {isUserOnOrange ? 'Your Team Lineup' : isUserOnBlue ? 'Opponents Lineup' : 'Orange Lineup'}
                  </h4>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      backgroundColor: isUserOnOrange ? 'rgba(251, 146, 60, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color: isUserOnOrange ? '#fb923c' : 'var(--text-muted)',
                      border: isUserOnOrange ? '1px solid rgba(251, 146, 60, 0.3)' : '1px solid var(--border-hairline)',
                    }}
                  >
                    ORANGE
                  </span>
                </div>
                {isUserOnOrange && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#34d399',
                      border: '1px solid #10b981',
                    }}
                  >
                    ★ YOUR SQUAD
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {orangePlayers.map(p =>
                  renderPlayerCard(
                    p,
                    '#fb923c',
                    'rgba(251, 146, 60, 0.09)',
                    '1px solid rgba(251, 146, 60, 0.28)',
                    '1px solid rgba(253, 186, 116, 0.5)'
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'pitch' && (
        <PitchVisualizer
          shots={match.shots}
          doubleCommits={match.double_commits}
          players={match.players}
          matchDurationSec={Math.max(300, Math.round((match.ended_at - match.started_at) / 1000))}
          activeTimeSec={activePlayTimeSec}
          onActiveTimeChange={setActivePlayTimeSec}
          onInspectPlayer={setSelectedPlayer}
        />
      )}

      {activeTab === 'compare' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <TaleOfTape match={match} />

          {/* Head-to-Head Dual Radar Overlay */}
          {match.players.length > 0 && (() => {
            const pA = match.players.find(p => p.player_key === radarPlayerA) || match.players[0];
            const pB = match.players.find(p => p.player_key === radarPlayerB) || match.players[match.players.length - 1];
            return (
              <div className="surface-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      Head-to-Head Attribute Overlay
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                      Compare any two players in this match side-by-side across all 8 tactical axes
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <select
                      value={pA.player_key}
                      onChange={e => setRadarPlayerA(e.target.value)}
                      style={{
                        backgroundColor: 'var(--bg-inset)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {match.players.map(pl => (
                        <option key={`a-${pl.player_key}`} value={pl.player_key}>
                          🔵 {pl.name} ({pl.rating.toFixed(1)})
                        </option>
                      ))}
                    </select>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)' }}>vs</span>
                    <select
                      value={pB.player_key}
                      onChange={e => setRadarPlayerB(e.target.value)}
                      style={{
                        backgroundColor: 'var(--bg-inset)',
                        color: '#fb923c',
                        border: '1px solid rgba(251, 146, 60, 0.4)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {match.players.map(pl => (
                        <option key={`b-${pl.player_key}`} value={pl.player_key}>
                          🟠 {pl.name} ({pl.rating.toFixed(1)})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAllRadars(prev => !prev)}
                      className="glass-pill"
                      style={{
                        color: 'var(--text-secondary)',
                        padding: '6px 11px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {showAllRadars ? 'Hide Full Grid' : `All Players Grid (${match.players.length})`}
                    </button>
                  </div>
                </div>

                <DualRadarChart
                  playerA={{ name: pA.name, radar: pA.radar }}
                  playerB={{ name: pB.name, radar: pB.radar }}
                />

                {showAllRadars && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-hairline)' }}>
                    {match.players.map(p => (
                      <RadarChart key={p.player_key} radar={p.radar} playerName={p.name} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Itemized Player Match Dossier, Titles & Rating Breakdown Modal */}
      <RatingModal
        player={selectedPlayer}
        awards={match.awards}
        onOpenProfile={onOpenProfile}
        onClose={() => setSelectedPlayer(null)}
      />
    </div>
  );
};
