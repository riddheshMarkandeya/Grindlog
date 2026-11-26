import React, { useState } from 'react';
import type { MatchAnalysisResult } from '../../shared/types.ts';
import { exportCanvasPng } from '../utils/canvas-export.ts';

interface DiscordExportProps {
  match: MatchAnalysisResult;
}

export const DiscordExport: React.FC<DiscordExportProps> = ({ match }) => {
  const [copied, setCopied] = useState(false);

  const generateCardImage = async () => {
    // Generate high-resolution 1200x630 Discord card on an off-screen HTML5 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background Gradient (FotMob pitch style)
    const bgGradient = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGradient.addColorStop(0, '#090e17');
    bgGradient.addColorStop(0.5, '#101726');
    bgGradient.addColorStop(1, '#080c14');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 1200, 630);

    // Border
    ctx.strokeStyle = '#233252';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 1160, 590);

    // Brand Header
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 22px system-ui';
    ctx.fillText('OVERTIMERL — MATCH CENTER', 50, 70);

    ctx.fillStyle = '#64748b';
    ctx.font = '16px system-ui';
    ctx.fillText(new Date(match.started_at).toLocaleString(), 50, 95);

    const userPlayer = match.players.find(p => p.is_user || p.name === 'Swapo_o');
    const userTeamNum = match.user_team_num ?? (userPlayer ? userPlayer.team_num : null);

    const isUserOnBlue = userTeamNum === 0;
    const isUserOnOrange = userTeamNum === 1;

    const blueHeader = isUserOnBlue ? 'YOUR TEAM (BLUE)' : isUserOnOrange ? 'OPPONENTS (BLUE)' : 'BLUE TEAM';
    const orangeHeader = isUserOnOrange ? 'YOUR TEAM (ORANGE)' : isUserOnBlue ? 'OPPONENTS (ORANGE)' : 'ORANGE TEAM';

    // Score & Header
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 32px system-ui';
    ctx.fillText(blueHeader, 350, 160);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px system-ui';
    ctx.fillText(`${match.score_team0}  -  ${match.score_team1}`, 600, 185);

    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 32px system-ui';
    ctx.fillText(orangeHeader, 850, 160);

    // Ratings & xG subtitle
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(
      `xG: ${match.team0_xg.toFixed(2)}  (Rating ${match.team0_rating.toFixed(1)})                xG: ${match.team1_xg.toFixed(2)}  (Rating ${match.team1_rating.toFixed(1)})`,
      600,
      230
    );

    // Divider
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 260);
    ctx.lineTo(1150, 260);
    ctx.stroke();

    // Render Blue Team Players
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px system-ui';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(isUserOnBlue ? 'YOUR TEAM (BLUE)' : 'OPPONENT TEAM (BLUE)', 80, 305);

    const bluePlayers = match.players.filter(p => p.team_num === 0);
    bluePlayers.forEach((p, i) => {
      const y = 350 + i * 55;
      // Rating badge pill
      ctx.fillStyle = p.rating >= 8.0 ? '#10b981' : p.rating >= 7.0 ? '#14b8a6' : '#64748b';
      ctx.beginPath();
      ctx.roundRect(80, y - 24, 60, 34, 8);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(p.rating.toFixed(1), 92, y);

      ctx.font = 'bold 20px system-ui';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(p.name, 155, y);

      ctx.font = '16px system-ui';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${p.goals}G ${p.assists}A ${p.saves}S  (${p.radar.archetype})`, 330, y);
    });

    // Render Orange Team Players
    ctx.font = 'bold 20px system-ui';
    ctx.fillStyle = '#fb923c';
    ctx.fillText(isUserOnOrange ? 'YOUR TEAM (ORANGE)' : 'OPPONENT TEAM (ORANGE)', 680, 305);

    const orangePlayers = match.players.filter(p => p.team_num === 1);
    orangePlayers.forEach((p, i) => {
      const y = 350 + i * 55;
      ctx.fillStyle = p.rating >= 8.0 ? '#10b981' : p.rating >= 7.0 ? '#14b8a6' : '#64748b';
      ctx.beginPath();
      ctx.roundRect(680, y - 24, 60, 34, 8);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(p.rating.toFixed(1), 692, y);

      ctx.font = 'bold 20px system-ui';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(p.name, 755, y);

      ctx.font = '16px system-ui';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${p.goals}G ${p.assists}A ${p.saves}S  (${p.radar.archetype})`, 930, y);
    });

    // Footer
    ctx.textAlign = 'center';
    ctx.font = 'italic 16px system-ui';
    ctx.fillStyle = '#475569';
    ctx.fillText('Powered by OvertimeRL + Grindlog Telemetry Engine', 600, 580);

    exportCanvasPng(canvas, `overtimerl-match-${match.guid.slice(0, 8)}.png`, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <button
      onClick={generateCardImage}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: copied ? '#10b981' : '#5865F2', // Discord Blurple
        color: '#ffffff',
        border: 'none',
        borderRadius: '10px',
        padding: '10px 18px',
        fontSize: '13px',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(88, 101, 242, 0.35)',
        transition: 'all 0.2s ease',
      }}
    >
      <span>{copied ? '✓ Copied to Clipboard!' : 'Export to Discord Card'}</span>
    </button>
  );
};
