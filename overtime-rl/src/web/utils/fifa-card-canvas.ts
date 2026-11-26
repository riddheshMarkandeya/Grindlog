import type { CarBodyType, FifaCardData, TrioSquadDossier } from '../../shared/types.ts';
import { exportCanvasPng } from './canvas-export.ts';

interface TierPalette {
  bgTop: string;
  bgMid: string;
  bgBot: string;
  borderOuter: string;
  borderInner: string;
  textMain: string;
  textMuted: string;
  accent: string;
  ribbonBg: string;
}

export function getFifaTierPalette(tier: FifaCardData['tier']): TierPalette {
  switch (tier) {
    case 'ICON':
      return {
        bgTop: '#f5efd6',
        bgMid: '#dfd2a6',
        bgBot: '#9e8853',
        borderOuter: '#fef3c7',
        borderInner: '#b48a3e',
        textMain: '#231b0b',
        textMuted: '#5b481b',
        accent: '#7c3aed',
        ribbonBg: 'rgba(35, 27, 11, 0.14)',
      };
    case 'ELITE':
      return {
        bgTop: '#16284f',
        bgMid: '#0f1b38',
        bgBot: '#091124',
        borderOuter: '#38bdf8',
        borderInner: '#1d4ed8',
        textMain: '#f8fafc',
        textMuted: '#93c5fd',
        accent: '#38bdf8',
        ribbonBg: 'rgba(56, 189, 248, 0.16)',
      };
    case 'GOLD':
      return {
        bgTop: '#4a3610',
        bgMid: '#2b1e08',
        bgBot: '#181004',
        borderOuter: '#fbbf24',
        borderInner: '#b45309',
        textMain: '#fef3c7',
        textMuted: '#fcd34d',
        accent: '#fbbf24',
        ribbonBg: 'rgba(251, 191, 36, 0.16)',
      };
    case 'SILVER':
      return {
        bgTop: '#334155',
        bgMid: '#1e293b',
        bgBot: '#0f172a',
        borderOuter: '#e2e8f0',
        borderInner: '#64748b',
        textMain: '#f8fafc',
        textMuted: '#cbd5e1',
        accent: '#e2e8f0',
        ribbonBg: 'rgba(226, 232, 240, 0.14)',
      };
    default:
      return {
        bgTop: '#432818',
        bgMid: '#28170d',
        bgBot: '#140b06',
        borderOuter: '#fb923c',
        borderInner: '#9a3412',
        textMain: '#ffedd5',
        textMuted: '#fdba74',
        accent: '#fb923c',
        ribbonBg: 'rgba(251, 146, 60, 0.16)',
      };
  }
}

function traceShieldPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const notch = w * 0.09;
  const topDip = h * 0.04;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w - notch, y + topDip);
  ctx.lineTo(x + w, y + topDip * 2.4);
  ctx.lineTo(x + w, y + h * 0.72);
  ctx.quadraticCurveTo(x + w, y + h * 0.88, x + w * 0.5, y + h);
  ctx.quadraticCurveTo(x, y + h * 0.88, x, y + h * 0.72);
  ctx.lineTo(x, y + topDip * 2.4);
  ctx.lineTo(x + notch, y + topDip);
  ctx.closePath();
}

function drawCarSilhouetteOnCanvas(
  ctx: CanvasRenderingContext2D,
  carBody: CarBodyType,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  glowColor: string
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Subtle boost flame
  const boostGrad = ctx.createLinearGradient(-115, 0, -45, 0);
  boostGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  boostGrad.addColorStop(1, glowColor);
  ctx.fillStyle = boostGrad;
  ctx.beginPath();
  ctx.moveTo(-48, 8);
  ctx.lineTo(-108, -4);
  ctx.lineTo(-88, 12);
  ctx.lineTo(-115, 20);
  ctx.lineTo(-48, 22);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';

  // Stylized Rocket League car side-profile silhouettes
  ctx.beginPath();
  if (carBody === 'fennec') {
    ctx.moveTo(-58, 22);
    ctx.lineTo(-56, -4);
    ctx.lineTo(-42, -8);
    ctx.lineTo(-18, -30);
    ctx.lineTo(18, -28);
    ctx.lineTo(42, -6);
    ctx.lineTo(64, -2);
    ctx.lineTo(66, 22);
  } else if (carBody === 'dominus') {
    ctx.moveTo(-68, 20);
    ctx.lineTo(-64, 0);
    ctx.lineTo(-44, -2);
    ctx.lineTo(-20, -24);
    ctx.lineTo(16, -24);
    ctx.lineTo(46, -4);
    ctx.lineTo(74, 2);
    ctx.lineTo(72, 20);
  } else if (carBody === 'breakout') {
    ctx.moveTo(-72, 20);
    ctx.lineTo(-66, 2);
    ctx.lineTo(-30, -20);
    ctx.lineTo(14, -22);
    ctx.lineTo(52, -2);
    ctx.lineTo(74, 6);
    ctx.lineTo(70, 20);
  } else {
    // Classic Octane & Hybrid sporty silhouette + rear wing
    ctx.moveTo(-60, 22);
    ctx.lineTo(-54, -2);
    ctx.lineTo(-64, -18);
    ctx.lineTo(-42, -16);
    ctx.lineTo(-34, -4);
    ctx.lineTo(-10, -28);
    ctx.lineTo(22, -26);
    ctx.lineTo(46, -2);
    ctx.lineTo(66, 4);
    ctx.lineTo(66, 22);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Wheels
  for (const wx of [-36, 38]) {
    ctx.beginPath();
    ctx.arc(wx, 22, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#090e17';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = glowColor;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draws a single FIFA/EA FC Shield Card onto the given 2D canvas context.
 */
export function drawFifaShieldOnCanvas(
  ctx: CanvasRenderingContext2D,
  card: FifaCardData,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const pal = getFifaTierPalette(card.tier);
  ctx.save();

  traceShieldPath(ctx, x, y, w, h);
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, pal.bgTop);
  bg.addColorStop(0.55, pal.bgMid);
  bg.addColorStop(1, pal.bgBot);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = Math.max(2, w * 0.012);
  ctx.strokeStyle = pal.borderOuter;
  ctx.stroke();

  // Subtle top edition banner
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.textMuted;
  ctx.font = `800 ${Math.round(w * 0.036)}px system-ui`;
  ctx.fillText(card.promo_edition, x + w * 0.5, y + h * 0.085);

  // Top-left OVR & Position
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.textMain;
  ctx.font = `900 ${Math.round(w * 0.16)}px system-ui`;
  ctx.fillText(String(card.ovr), x + w * 0.21, y + h * 0.22);

  ctx.font = `800 ${Math.round(w * 0.068)}px system-ui`;
  ctx.fillStyle = pal.textMuted;
  ctx.fillText(card.position, x + w * 0.21, y + h * 0.285);

  // Top-right cycle & delta badge
  ctx.textAlign = 'right';
  ctx.font = `800 ${Math.round(w * 0.038)}px monospace`;
  ctx.fillStyle = pal.accent;
  const cycleTxt = card.cycle.is_provisional
    ? `PROV ${card.cycle.total_matches}/${card.cycle.cycle_size}`
    : `CYC #${card.cycle.current_cycle}`;
  ctx.fillText(cycleTxt, x + w * 0.87, y + h * 0.17);
  ctx.fillStyle = pal.textMuted;
  ctx.font = `700 ${Math.round(w * 0.034)}px system-ui`;
  ctx.fillText(card.car_body.toUpperCase(), x + w * 0.87, y + h * 0.22);

  // Center Car Vector
  drawCarSilhouetteOnCanvas(
    ctx,
    card.car_body,
    x + w * 0.56,
    y + h * 0.34,
    w / 320,
    pal.borderOuter,
    pal.accent
  );

  // Nameplate bar
  const ribY = y + h * 0.48;
  ctx.fillStyle = pal.ribbonBg;
  ctx.fillRect(x + w * 0.08, ribY, w * 0.84, h * 0.115);

  ctx.textAlign = 'center';
  ctx.fillStyle = pal.textMain;
  ctx.font = `900 ${Math.round(w * 0.078)}px system-ui`;
  ctx.fillText(card.display_name.toUpperCase().slice(0, 18), x + w * 0.5, ribY + h * 0.056);

  ctx.fillStyle = pal.textMuted;
  ctx.font = `700 ${Math.round(w * 0.036)}px system-ui`;
  ctx.fillText(card.card_title.toUpperCase().slice(0, 26), x + w * 0.5, ribY + h * 0.095);

  // 2x3 Classic Stats
  const statsY = y + h * 0.655;
  const rowGap = h * 0.058;
  const leftCols = [
    { label: 'PAC', val: card.stats.pac },
    { label: 'SHO', val: card.stats.sho },
    { label: 'PAS', val: card.stats.pas },
  ];
  const rightCols = [
    { label: 'DRI', val: card.stats.dri },
    { label: 'TAC', val: card.stats.tac },
    { label: 'GK', val: card.stats.gk },
  ];

  // Center vertical divider
  ctx.strokeStyle = pal.borderInner;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, statsY - h * 0.03);
  ctx.lineTo(x + w * 0.5, statsY + rowGap * 2.25);
  ctx.stroke();

  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    const ry = statsY + i * rowGap;
    ctx.fillStyle = pal.textMain;
    ctx.font = `900 ${Math.round(w * 0.068)}px monospace`;
    ctx.fillText(String(leftCols[i].val), x + w * 0.19, ry);
    ctx.fillStyle = pal.textMuted;
    ctx.font = `700 ${Math.round(w * 0.052)}px system-ui`;
    ctx.fillText(leftCols[i].label, x + w * 0.32, ry);

    ctx.fillStyle = pal.textMain;
    ctx.font = `900 ${Math.round(w * 0.068)}px monospace`;
    ctx.fillText(String(rightCols[i].val), x + w * 0.57, ry);
    ctx.fillStyle = pal.textMuted;
    ctx.font = `700 ${Math.round(w * 0.052)}px system-ui`;
    ctx.fillText(rightCols[i].label, x + w * 0.70, ry);
  }

  // Sub-footer AER · DIS · /800
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.textMuted;
  ctx.font = `800 ${Math.round(w * 0.035)}px monospace`;
  ctx.fillText(
    `AER ${card.stats.aer}  ·  DIS ${card.stats.dis}  ·  ${card.total800}/800`,
    x + w * 0.5,
    y + h * 0.855
  );

  // Bottom PlayStyles+ strip
  const psCount = Math.min(3, card.playstyles.length);
  if (psCount > 0) {
    const startX = x + w * 0.5 - ((psCount - 1) * w * 0.24) / 2;
    card.playstyles.slice(0, 3).forEach((ps, idx) => {
      const px = startX + idx * w * 0.24;
      const py = y + h * 0.915;
      ctx.fillStyle = ps.tier === 'plus' ? '#fbbf24' : pal.borderOuter;
      ctx.font = `800 ${Math.round(w * 0.032)}px system-ui`;
      ctx.fillText(`${ps.name}${ps.tier === 'plus' ? '+' : ''}`, px, py);
    });
  }

  ctx.restore();
}

/**
 * Generates and copies/downloads a single FIFA+RL Shield Card PNG for Discord.
 */
export function exportSingleFifaCardPng(card: FifaCardData, onDone: () => void): void {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = ctx.createRadialGradient(320, 420, 40, 320, 460, 520);
  bg.addColorStop(0, '#13203b');
  bg.addColorStop(1, '#060911');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 920);

  drawFifaShieldOnCanvas(ctx, card, 95, 55, 450, 720);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 15px monospace';
  const cycleText = card.cycle.is_provisional
    ? `PROVISIONAL (${card.cycle.total_matches}/${card.cycle.cycle_size} MATCHES)`
    : `LOCKED CYCLE #${card.cycle.current_cycle} · MATCHES #${card.cycle.window_start_match}-${card.cycle.window_end_match} · WR ${card.cycle.win_rate}%`;
  ctx.fillText(cycleText, 320, 825);

  ctx.fillStyle = '#475569';
  ctx.font = 'italic 14px system-ui';
  ctx.fillText('OVERTIMERL · UNIFIED FIFA+RL CARD', 320, 868);

  exportCanvasPng(canvas, `overtimerl-card-${card.player_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, onDone);
}

/**
 * Generates and copies/downloads a 3-Card Trio Formation PNG with Chemistry Links for Discord.
 */
export function exportTrioFormationPng(
  cards: FifaCardData[],
  trio: TrioSquadDossier,
  onDone: () => void
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1360;
  canvas.height = 780;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, 1360, 780);
  bg.addColorStop(0, '#070b14');
  bg.addColorStop(0.5, '#0e192d');
  bg.addColorStop(1, '#060911');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1360, 780);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 1320, 740);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.font = '900 26px system-ui';
  ctx.fillText('OVERTIMERL — ULTIMATE TRIO SQUAD', 50, 68);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#34d399';
  ctx.font = '800 22px monospace';
  ctx.fillText(
    `${trio.wins}W-${trio.losses}L (${trio.win_rate}%)  ·  ${trio.double_commits_per_game} DC/gm`,
    1310,
    68
  );

  const positions = [
    { x: 110, y: 120 },
    { x: 515, y: 100 },
    { x: 920, y: 120 },
  ];

  // Chemistry lines connecting pairs
  ctx.strokeStyle = trio.win_rate >= 52 ? '#10b981' : '#f59e0b';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(275, 380);
  ctx.lineTo(680, 360);
  ctx.lineTo(1085, 380);
  ctx.stroke();

  cards.slice(0, 3).forEach((card, i) => {
    const pos = positions[i] || positions[0];
    drawFifaShieldOnCanvas(ctx, card, pos.x, pos.y, 330, 530);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = 'italic 16px system-ui';
  ctx.fillText(`3s Core Roster (${trio.matches_together} Mutual Matches) · Powered by OvertimeRL`, 680, 725);

  exportCanvasPng(canvas, 'overtimerl-trio-squad-cards.png', onDone);
}
