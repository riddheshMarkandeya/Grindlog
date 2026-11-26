import React, { useState } from 'react';
import type { PodiumPlayer, SessionRecap } from '../../shared/types.ts';
import { exportCanvasPng } from '../utils/canvas-export.ts';

interface SessionDiscordExportProps {
  session: SessionRecap;
}

const RANK_THEMES = [
  { label: '#1 • PLAYER OF THE NIGHT', badgeBg: '#f59e0b', accent: '#facc15', border: 'rgba(250, 204, 21, 0.5)' },
  { label: '#2 • RUNNER UP', badgeBg: '#94a3b8', accent: '#e2e8f0', border: 'rgba(148, 163, 184, 0.42)' },
  { label: '#3 • PODIUM', badgeBg: '#d97706', accent: '#fb923c', border: 'rgba(217, 119, 6, 0.45)' },
];

function drawStatTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor: string
): void {
  ctx.fillStyle = '#0e1628';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px system-ui';
  ctx.fillText(label, x + w / 2, y + 26);

  ctx.fillStyle = valueColor;
  ctx.font = 'bold 28px monospace';
  ctx.fillText(value, x + w / 2, y + 62);
}

function drawPlayerPodiumCard(
  ctx: CanvasRenderingContext2D,
  player: PodiumPlayer,
  rankIndex: number,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const theme = RANK_THEMES[rankIndex] ?? RANK_THEMES[2];

  // Elevated card background
  const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
  cardGrad.addColorStop(0, rankIndex === 0 ? '#1b2033' : '#131b2d');
  cardGrad.addColorStop(1, '#0b111e');
  ctx.fillStyle = cardGrad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = rankIndex === 0 ? 2.5 : 1.5;
  ctx.stroke();

  // Top rank header strip
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 12px system-ui';
  ctx.fillText(theme.label, x + w / 2, y + 34);

  // Player Name (clamped safely to avoid overlap)
  const displayName = player.name.length > 18 ? `${player.name.slice(0, 17)}…` : player.name;
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px system-ui';
  ctx.fillText(displayName, x + w / 2, y + 70);

  // Rating badge pill
  const ratingBg = player.avg_rating >= 8.0 ? '#10b981' : player.avg_rating >= 7.0 ? '#0ea5e9' : '#64748b';
  ctx.fillStyle = ratingBg;
  ctx.beginPath();
  ctx.roundRect(x + w / 2 - 48, y + 90, 96, 42, 12);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(player.avg_rating.toFixed(1), x + w / 2, y + 119);

  // Matches & Win % subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 14px system-ui';
  ctx.fillText(`${player.matches_played} Games  •  ${player.win_rate}% Win Rate`, x + w / 2, y + 158);

  // Spacious 2x2 stat grid: Goals, Assists, Saves, Double Commits
  const padX = 22;
  const gap = 12;
  const tileW = (w - padX * 2 - gap) / 2;
  const tileH = 78;
  const gridTop = y + 182;

  drawStatTile(ctx, x + padX, gridTop, tileW, tileH, 'GOALS', String(player.total_goals), '#34d399');
  drawStatTile(ctx, x + padX + tileW + gap, gridTop, tileW, tileH, 'ASSISTS', String(player.total_assists ?? 0), '#38bdf8');
  drawStatTile(ctx, x + padX, gridTop + tileH + gap, tileW, tileH, 'SAVES', String(player.total_saves ?? 0), '#c084fc');

  const dcVal = player.total_double_commits ?? 0;
  const dcRate = player.matches_played > 0 ? dcVal / player.matches_played : 0;
  const dcColor = dcRate > 1.2 ? '#fb923c' : '#fbbf24';
  drawStatTile(ctx, x + padX + tileW + gap, gridTop + tileH + gap, tileW, tileH, 'DOUBLE COMMITS', String(dcVal), dcColor);
}

/**
 * Generates and exports a spacious 1200x675 Session Leaderboard Discord PNG card
 * summarizing Squad W/L, Goals, Assists, Saves, and Double Commits without clutter.
 */
export const SessionDiscordExport: React.FC<SessionDiscordExportProps> = ({ session }) => {
  const [copied, setCopied] = useState(false);

  const generateSessionCard = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 675;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark Liquid Glass Arena Backdrop
    const bg = ctx.createLinearGradient(0, 0, 1200, 675);
    bg.addColorStop(0, '#070b13');
    bg.addColorStop(0.5, '#0f172a');
    bg.addColorStop(1, '#060a12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 675);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, 1160, 635);

    // Header Left: Brand + Session Title
    ctx.textAlign = 'left';
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 16px system-ui';
    ctx.fillText('OVERTIMERL  •  SQUAD SESSION RECAP', 52, 62);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px system-ui';
    ctx.fillText('Player of the Night Podium', 52, 104);

    ctx.fillStyle = '#64748b';
    ctx.font = '15px system-ui';
    ctx.fillText(`${session.total_matches} Matches Analyzed  •  ${new Date().toLocaleDateString()}`, 52, 132);

    // Header Right: Clean KPI Pills (Record + Team Goals + Double Commits)
    const drawHeaderPill = (px: number, pw: number, title: string, val: string, valColor: string) => {
      ctx.fillStyle = '#111a2e';
      ctx.beginPath();
      ctx.roundRect(px, 50, pw, 78, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText(title, px + pw / 2, 74);

      ctx.fillStyle = valColor;
      ctx.font = 'bold 26px monospace';
      ctx.fillText(val, px + pw / 2, 108);
    };

    const gf = session.total_goals_for ?? 0;
    const ga = session.total_goals_against ?? 0;
    const teamDc = session.total_double_commits ?? 0;
    drawHeaderPill(610, 175, 'SESSION W / L', `${session.wins}W - ${session.losses}L`, '#38bdf8');
    drawHeaderPill(802, 175, 'SQUAD GOALS', `${gf} - ${ga}`, gf >= ga ? '#34d399' : '#f87171');
    drawHeaderPill(994, 154, 'TEAM OVERLAPS', `${teamDc} DC`, '#fbbf24');

    // Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(52, 156);
    ctx.lineTo(1148, 156);
    ctx.stroke();

    // Top 3 Friend Podium Cards (centered cleanly for 1, 2, or 3 players)
    const players = session.podium.slice(0, 3);
    if (players.length === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 22px system-ui';
      ctx.fillText('No squad friend matches recorded in this session yet.', 600, 380);
    } else {
      const cardW = 342;
      const cardH = 384;
      const cardGap = 35;
      const totalRowW = players.length * cardW + (players.length - 1) * cardGap;
      const startX = (1200 - totalRowW) / 2;
      const cardY = 186;

      players.forEach((p, idx) => {
        drawPlayerPodiumCard(ctx, p, idx, startX + idx * (cardW + cardGap), cardY, cardW, cardH);
      });
    }

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = 'italic 15px system-ui';
    ctx.fillText('OvertimeRL + Grindlog Telemetry  •  Session Goals, Assists, Saves & Double Commits', 600, 622);

    const dateTag = new Date().toISOString().slice(0, 10);
    exportCanvasPng(canvas, `overtimerl-session-${dateTag}.png`, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <button
      onClick={generateSessionCard}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: copied ? '#10b981' : '#5865F2',
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
      <span>{copied ? '✓ Copied Session Card!' : 'Export Session Discord Card'}</span>
    </button>
  );
};
