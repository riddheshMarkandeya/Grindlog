import React from 'react';
import type { MatchAnalysisResult } from '../../shared/types.ts';

interface TaleOfTapeProps {
  match: MatchAnalysisResult;
}

export const TaleOfTape: React.FC<TaleOfTapeProps> = ({ match }) => {
  const t0 = match.players.filter(p => p.team_num === 0);
  const t1 = match.players.filter(p => p.team_num === 1);

  const t0Goals = match.score_team0;
  const t1Goals = match.score_team1;
  const t0XG = match.team0_xg;
  const t1XG = match.team1_xg;

  const t0Shots = t0.reduce((acc, p) => acc + p.shots, 0);
  const t1Shots = t1.reduce((acc, p) => acc + p.shots, 0);

  const t0Saves = t0.reduce((acc, p) => acc + p.saves, 0);
  const t1Saves = t1.reduce((acc, p) => acc + p.saves, 0);

  const t0Demos = t0.reduce((acc, p) => acc + p.demos, 0);
  const t1Demos = t1.reduce((acc, p) => acc + p.demos, 0);

  const t0Touches = t0.reduce((acc, p) => acc + p.touches, 0);
  const t1Touches = t1.reduce((acc, p) => acc + p.touches, 0);
  const totalTouches = Math.max(1, t0Touches + t1Touches);
  const t0FieldTilt = Math.round((t0Touches / totalTouches) * 100);
  const t1FieldTilt = 100 - t0FieldTilt;

  const userPlayer = match.players.find(p => p.is_user || p.name === 'Swapo_o');
  const userTeamNum = match.user_team_num ?? (userPlayer ? userPlayer.team_num : null);

  const isUserTeam0 = userTeamNum === 0;
  const isUserTeam1 = userTeamNum === 1;

  const t0DoubleCommits = Math.round(t0.reduce((acc, p) => acc + (p.double_commits || 0), 0) / 2);
  const t1DoubleCommits = Math.round(t1.reduce((acc, p) => acc + (p.double_commits || 0), 0) / 2);

  const t0Label = isUserTeam0 ? 'YOUR TEAM (Blue)' : isUserTeam1 ? 'OPPONENTS (Blue)' : 'Blue Team';
  const t1Label = isUserTeam1 ? 'YOUR TEAM (Orange)' : isUserTeam0 ? 'OPPONENTS (Orange)' : 'Orange Team';

  const rows = [
    { label: 'Score', v0: t0Goals, v1: t1Goals },
    { label: 'Expected Goals (xG)', v0: t0XG, v1: t1XG, format: (v: number) => v.toFixed(2) },
    { label: 'Field Tilt (Possession)', v0: t0FieldTilt, v1: t1FieldTilt, format: (v: number) => `${v}%` },
    { label: 'Total Shots', v0: t0Shots, v1: t1Shots },
    { label: 'Saves', v0: t0Saves, v1: t1Saves },
    { label: 'Demolitions Dealt', v0: t0Demos, v1: t1Demos },
    { label: 'Double Commits', v0: t0DoubleCommits, v1: t1DoubleCommits },
    { label: 'Team FotMob Rating', v0: match.team0_rating, v1: match.team1_rating, format: (v: number) => v.toFixed(1) },
  ];

  return (
    <div className="surface-card" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Tale of the Tape (Team Comparison)</h3>
        <div style={{ display: 'flex', gap: '20px', fontWeight: 800, fontSize: '13px', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}>
            {t0Label}
            <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', backgroundColor: isUserTeam0 ? '#065f46' : '#1e293b', color: isUserTeam0 ? '#34d399' : '#94a3b8', border: isUserTeam0 ? '1px solid #10b981' : '1px solid #334155' }}>
              {isUserTeam0 ? '★ YOU' : isUserTeam1 ? 'OPPONENT' : 'BLUE'}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fb923c' }}>
            {t1Label}
            <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', backgroundColor: isUserTeam1 ? '#065f46' : '#1e293b', color: isUserTeam1 ? '#34d399' : '#94a3b8', border: isUserTeam1 ? '1px solid #10b981' : '1px solid #334155' }}>
              {isUserTeam1 ? '★ YOU' : isUserTeam0 ? 'OPPONENT' : 'ORANGE'}
            </span>
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {rows.map((row, idx) => {
          const sum = (Number(row.v0) || 0) + (Number(row.v1) || 0);
          const p0 = sum > 0 ? ((Number(row.v0) || 0) / sum) * 100 : 50;
          const p1 = 100 - p0;
          const v0Text = row.format ? row.format(row.v0) : row.v0;
          const v1Text = row.format ? row.format(row.v1) : row.v1;

          return (
            <div key={idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ fontWeight: 800, color: '#f8fafc', minWidth: '40px' }}>{v0Text}</span>
                <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>{row.label}</span>
                <span style={{ fontWeight: 800, color: '#f8fafc', minWidth: '40px', textAlign: 'right' }}>{v1Text}</span>
              </div>
              <div style={{ height: '8px', width: '100%', backgroundColor: '#090e17', borderRadius: '4px', display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: `${p0}%`, backgroundColor: '#38bdf8', transition: 'width 0.4s ease' }} />
                <div style={{ width: `${p1}%`, backgroundColor: '#fb923c', transition: 'width 0.4s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
