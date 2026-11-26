import type { CarBodyType, FifaCardData, TrioSquadDossier } from '../../shared/types.ts';
import { exportCanvasPng } from './canvas-export.ts';

export type VisualCardTheme = 'GOLD' | 'TOTW' | 'TOTY' | 'ICON' | 'SILVER' | 'BRONZE';

export interface FifaCardVisualSpec {
  theme: VisualCardTheme;
  bgUpper1: string;
  bgUpper2: string;
  bgLower1: string;
  bgLower2: string;
  rayColor: string;
  rayColor2: string;
  borderOuter: string;
  borderInner: string;
  textMain: string;
  textSub: string;
  divider: string;
  accentGlow: string;
  topEmblem?: string;
}

/**
 * Resolves authentic FIFA card templates (Gold Rare, Obsidian-Gold TOTW, Sapphire-Gold TOTY,
 * Pearl-Gold ICON, Platinum Silver, Copper Bronze) from card OVR & promo_edition.
 */
export function getFifaCardVisualSpec(card: Pick<FifaCardData, 'tier' | 'promo_edition'>): FifaCardVisualSpec {
  if (card.promo_edition === 'IN-FORM TOTW') {
    return {
      theme: 'TOTW',
      bgUpper1: '#232329',
      bgUpper2: '#0b0b0e',
      bgLower1: '#141418',
      bgLower2: '#070709',
      rayColor: 'rgba(232, 191, 78, 0.28)',
      rayColor2: 'rgba(252, 232, 154, 0.14)',
      borderOuter: '#efd074',
      borderInner: '#9e741c',
      textMain: '#fce89c',
      textSub: '#d9b85b',
      divider: 'rgba(239, 208, 116, 0.35)',
      accentGlow: '#f5c84c',
      topEmblem: 'TOTW',
    };
  }
  if (card.tier === 'ICON') {
    return {
      theme: 'ICON',
      bgUpper1: '#fdf9ec',
      bgUpper2: '#e7d9ad',
      bgLower1: '#f4ebd0',
      bgLower2: '#cbb374',
      rayColor: 'rgba(196, 154, 58, 0.18)',
      rayColor2: 'rgba(255, 255, 255, 0.45)',
      borderOuter: '#e3c05c',
      borderInner: '#997523',
      textMain: '#281f09',
      textSub: '#5e4918',
      divider: 'rgba(72, 54, 15, 0.28)',
      accentGlow: '#eab308',
      topEmblem: 'ICON',
    };
  }
  if (card.tier === 'ELITE') {
    return {
      theme: 'TOTY',
      bgUpper1: '#1243cc',
      bgUpper2: '#061a66',
      bgLower1: '#09237d',
      bgLower2: '#030c33',
      rayColor: 'rgba(56, 189, 248, 0.20)',
      rayColor2: 'rgba(11, 18, 60, 0.55)',
      borderOuter: '#ecd178',
      borderInner: '#a78328',
      textMain: '#fae58e',
      textSub: '#e3c764',
      divider: 'rgba(236, 209, 120, 0.36)',
      accentGlow: '#38bdf8',
      topEmblem: 'ORL',
    };
  }
  if (card.tier === 'GOLD') {
    return {
      theme: 'GOLD',
      bgUpper1: '#faecc0',
      bgUpper2: '#cfa73c',
      bgLower1: '#ebd178',
      bgLower2: '#c5992c',
      rayColor: 'rgba(255, 250, 224, 0.42)',
      rayColor2: 'rgba(161, 117, 22, 0.22)',
      borderOuter: '#f7e49c',
      borderInner: '#9a7116',
      textMain: '#2d2106',
      textSub: '#564112',
      divider: 'rgba(65, 47, 10, 0.32)',
      accentGlow: '#fbbf24',
    };
  }
  if (card.tier === 'SILVER') {
    return {
      theme: 'SILVER',
      bgUpper1: '#f1f5f9',
      bgUpper2: '#94a3b8',
      bgLower1: '#dfe6ee',
      bgLower2: '#8998ac',
      rayColor: 'rgba(255, 255, 255, 0.48)',
      rayColor2: 'rgba(51, 65, 85, 0.16)',
      borderOuter: '#f8fafc',
      borderInner: '#64748b',
      textMain: '#0f172a',
      textSub: '#334155',
      divider: 'rgba(15, 23, 42, 0.28)',
      accentGlow: '#cbd5e1',
    };
  }
  return {
    theme: 'BRONZE',
    bgUpper1: '#e6ae83',
    bgUpper2: '#965326',
    bgLower1: '#d18e5d',
    bgLower2: '#7a4019',
    rayColor: 'rgba(255, 229, 204, 0.32)',
    rayColor2: 'rgba(92, 42, 12, 0.24)',
    borderOuter: '#f0be97',
    borderInner: '#6b3512',
    textMain: '#241104',
    textSub: '#4d260b',
    divider: 'rgba(36, 17, 4, 0.28)',
    accentGlow: '#fb923c',
  };
}

/**
 * Exact authentic curved EA FC / FIFA Shield SVG path in 300x430 normalized space.
 */
export const FIFA_SHIELD_PATH_D =
  'M 150 4 C 194 4 234 10 262 22 Q 268 36 286 38 L 286 340 C 286 382 204 402 150 426 C 96 402 14 382 14 340 L 14 38 Q 32 36 38 22 C 66 10 106 4 150 4 Z';

export const FIFA_SHIELD_INNER_PATH_D =
  'M 150 11 C 192 11 230 17 256 28 Q 262 41 278 44 L 278 338 C 278 376 200 395 150 417 C 100 395 22 376 22 338 L 22 44 Q 38 41 44 28 C 70 17 108 11 150 11 Z';

function traceCurvedShield(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const sx = w / 300;
  const sy = h / 430;
  const px = (nx: number) => x + nx * sx;
  const py = (ny: number) => y + ny * sy;

  ctx.beginPath();
  ctx.moveTo(px(150), py(4));
  ctx.bezierCurveTo(px(194), py(4), px(234), py(10), px(262), py(22));
  ctx.quadraticCurveTo(px(268), py(36), px(286), py(38));
  ctx.lineTo(px(286), py(340));
  ctx.bezierCurveTo(px(286), py(382), px(204), py(402), px(150), py(426));
  ctx.bezierCurveTo(px(96), py(402), px(14), py(382), px(14), py(340));
  ctx.lineTo(px(14), py(38));
  ctx.quadraticCurveTo(px(32), py(36), px(38), py(22));
  ctx.bezierCurveTo(px(66), py(10), px(106), py(4), px(150), py(4));
  ctx.closePath();
}

const carImageCache = new Map<string, HTMLImageElement>();

function loadCarImage(carBody: CarBodyType): Promise<HTMLImageElement | null> {
  const key = carBody === 'hybrid' ? 'fennec' : carBody;
  const cached = carImageCache.get(key);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      carImageCache.set(key, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `/cars/${key}.png`;
  });
}

function drawFoilTextureOnCanvas(
  ctx: CanvasRenderingContext2D,
  spec: FifaCardVisualSpec,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const sx = w / 300;
  const sy = h / 430;
  const horizonY = y + 248 * sy;

  // Upper canvas fill
  const upGrad = ctx.createRadialGradient(x + w * 0.25, y + h * 0.16, 10, x + w * 0.5, y + h * 0.3, w * 0.72);
  upGrad.addColorStop(0, spec.bgUpper1);
  upGrad.addColorStop(1, spec.bgUpper2);
  ctx.fillStyle = upGrad;
  ctx.fillRect(x, y, w, h * 0.6);

  // Diagonal rays / TOTW lightning / TOTY ribbons
  ctx.save();
  if (spec.theme === 'TOTW') {
    // Bold TOTW gold lightning streaks
    const shards = [
      [85, 248, 200, 18, 232, 18, 128, 248],
      [135, 248, 268, 42, 290, 74, 178, 248],
      [196, 248, 290, 122, 290, 155, 224, 248],
    ];
    shards.forEach((p, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? spec.rayColor : spec.rayColor2;
      ctx.beginPath();
      ctx.moveTo(x + p[0] * sx, y + p[1] * sy);
      ctx.lineTo(x + p[2] * sx, y + p[3] * sy);
      ctx.lineTo(x + p[4] * sx, y + p[5] * sy);
      ctx.lineTo(x + p[6] * sx, y + p[7] * sy);
      ctx.closePath();
      ctx.fill();
    });
  } else if (spec.theme === 'TOTY') {
    // Dynamic curved sapphire silk ribbons
    ctx.fillStyle = spec.rayColor2;
    ctx.beginPath();
    ctx.moveTo(x + 90 * sx, y);
    ctx.quadraticCurveTo(x + 170 * sx, y + 120 * sy, x + 286 * sx, y + 90 * sy);
    ctx.lineTo(x + 286 * sx, y + 210 * sy);
    ctx.quadraticCurveTo(x + 150 * sx, y + 170 * sy, x + 14 * sx, y + 240 * sy);
    ctx.lineTo(x + 14 * sx, y + 140 * sy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = spec.rayColor;
    ctx.beginPath();
    ctx.moveTo(x + 14 * sx, y + 115 * sy);
    ctx.lineTo(x + 235 * sx, y);
    ctx.lineTo(x + 275 * sx, y);
    ctx.lineTo(x + 14 * sx, y + 152 * sy);
    ctx.closePath();
    ctx.fill();
  } else {
    // Classic Gold/Silver/Bronze etched diagonal rays
    const rays = [
      [42, 248, 175, 10, 214, 10, 88, 248],
      [118, 248, 254, 20, 286, 56, 156, 248],
      [182, 248, 286, 112, 286, 144, 208, 248],
    ];
    rays.forEach((p, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? spec.rayColor : spec.rayColor2;
      ctx.beginPath();
      ctx.moveTo(x + p[0] * sx, y + p[1] * sy);
      ctx.lineTo(x + p[2] * sx, y + p[3] * sy);
      ctx.lineTo(x + p[4] * sx, y + p[5] * sy);
      ctx.lineTo(x + p[6] * sx, y + p[7] * sy);
      ctx.closePath();
      ctx.fill();
    });
  }
  ctx.restore();

  // Lower matte satin panel
  const lowGrad = ctx.createLinearGradient(x, horizonY, x, y + h);
  lowGrad.addColorStop(0, spec.bgLower1);
  lowGrad.addColorStop(1, spec.bgLower2);
  ctx.fillStyle = lowGrad;
  ctx.fillRect(x, horizonY, w, y + h - horizonY);

  // Horizon hairline
  ctx.strokeStyle = spec.divider;
  ctx.lineWidth = Math.max(1, 1.3 * sx);
  ctx.beginPath();
  ctx.moveTo(x + 14 * sx, horizonY);
  ctx.lineTo(x + 286 * sx, horizonY);
  ctx.stroke();
}

/**
 * Draws an authentic curved EA FC Shield Card (with actual Rocket League car image) onto Canvas.
 */
export function drawFifaShieldOnCanvas(
  ctx: CanvasRenderingContext2D,
  card: FifaCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  carImg?: HTMLImageElement | null
): void {
  const spec = getFifaCardVisualSpec(card);
  const sx = w / 300;
  const sy = h / 430;

  ctx.save();
  traceCurvedShield(ctx, x, y, w, h);
  ctx.clip();

  drawFoilTextureOnCanvas(ctx, spec, x, y, w, h);

  // Top center emblem badge for special editions (matches Hazard TOTY top crown crest)
  if (spec.topEmblem) {
    ctx.textAlign = 'center';
    ctx.fillStyle = spec.textSub;
    ctx.font = `900 ${Math.round(10 * sx)}px system-ui`;
    ctx.fillText(spec.topEmblem, x + 150 * sx, y + 26 * sy);
  }

  // Top-Left Clean Metadata Column: OVR -> POS -> Rule -> Mode Crest -> Rule -> Squad Crest
  const colX = x + 56 * sx;
  ctx.textAlign = 'center';
  ctx.fillStyle = spec.textMain;
  ctx.font = `900 ${Math.round(46 * sx)}px system-ui`;
  ctx.fillText(String(card.ovr), colX, y + 84 * sy);

  ctx.fillStyle = spec.textSub;
  ctx.font = `800 ${Math.round(17 * sx)}px system-ui`;
  ctx.fillText(card.position, colX, y + 106 * sy);

  // Rule 1
  ctx.strokeStyle = spec.divider;
  ctx.lineWidth = Math.max(1, 1.2 * sx);
  ctx.beginPath();
  ctx.moveTo(colX - 18 * sx, y + 116 * sy);
  ctx.lineTo(colX + 18 * sx, y + 116 * sy);
  ctx.stroke();

  // Visual Blue/Silver/Orange Rocket League Stadium Flag
  const fx = colX - 15 * sx;
  const fy = y + 124 * sy;
  const fw = 30 * sx;
  const fh = 18 * sy;
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(fx, fy, fw, fh / 3);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(fx, fy + fh / 3, fw, fh / 3);
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(fx, fy + (2 * fh) / 3, fw, fh / 3);
  ctx.strokeStyle = spec.divider;
  ctx.lineWidth = Math.max(0.8, 0.9 * sx);
  ctx.strokeRect(fx, fy, fw, fh);

  // Rule 2
  ctx.beginPath();
  ctx.moveTo(colX - 18 * sx, y + 150 * sy);
  ctx.lineTo(colX + 18 * sx, y + 150 * sy);
  ctx.stroke();

  // Mode / Club Crest Emblem (2V2 / 3V3 / ORL)
  ctx.strokeStyle = spec.textMain;
  ctx.lineWidth = Math.max(1.2, 1.5 * sx);
  ctx.beginPath();
  ctx.arc(colX, y + 174 * sy, 14 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = spec.textMain;
  ctx.font = `900 ${Math.round(8.5 * sx)}px system-ui`;
  const crestText = card.mode === '2s' ? '2V2' : card.mode === '3s' ? '3V3' : 'ORL';
  ctx.fillText(crestText, colX, y + 177 * sy);

  // Hero Car Artwork (Upper Right Portrait Slot)
  if (carImg && carImg.naturalWidth > 0) {
    const boxW = 198 * sx;
    const boxH = 158 * sy;
    const ratio = Math.min(boxW / carImg.naturalWidth, boxH / carImg.naturalHeight);
    const dw = carImg.naturalWidth * ratio;
    const dh = carImg.naturalHeight * ratio;
    const dx = x + 92 * sx + (boxW - dw) / 2;
    const dy = y + 66 * sy + (boxH - dh) * 0.6;
    ctx.drawImage(carImg, dx, dy, dw, dh);
  }

  // Nameplate (Centered bold uppercase above thin horizontal rule — pure FIFA style)
  ctx.textAlign = 'center';
  ctx.fillStyle = spec.textMain;
  ctx.font = `900 ${Math.round(24 * sx)}px system-ui`;
  ctx.fillText(card.display_name.toUpperCase().slice(0, 16), x + 150 * sx, y + 282 * sy);

  ctx.strokeStyle = spec.divider;
  ctx.lineWidth = Math.max(1, 1.2 * sx);
  ctx.beginPath();
  ctx.moveTo(x + 40 * sx, y + 292 * sy);
  ctx.lineTo(x + 260 * sx, y + 292 * sy);
  ctx.stroke();

  // Classic 2x3 Stats Grid with center divider
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

  ctx.strokeStyle = spec.divider;
  ctx.beginPath();
  ctx.moveTo(x + 150 * sx, y + 304 * sy);
  ctx.lineTo(x + 150 * sx, y + 382 * sy);
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const ry = y + (322 + i * 26) * sy;
    ctx.textAlign = 'right';
    ctx.fillStyle = spec.textMain;
    ctx.font = `900 ${Math.round(19 * sx)}px system-ui`;
    ctx.fillText(String(leftCols[i].val), x + 86 * sx, ry);

    ctx.textAlign = 'left';
    ctx.fillStyle = spec.textSub;
    ctx.font = `600 ${Math.round(15 * sx)}px system-ui`;
    ctx.fillText(leftCols[i].label, x + 92 * sx, ry);

    ctx.textAlign = 'right';
    ctx.fillStyle = spec.textMain;
    ctx.font = `900 ${Math.round(19 * sx)}px system-ui`;
    ctx.fillText(String(rightCols[i].val), x + 198 * sx, ry);

    ctx.textAlign = 'left';
    ctx.fillStyle = spec.textSub;
    ctx.font = `600 ${Math.round(15 * sx)}px system-ui`;
    ctx.fillText(rightCols[i].label, x + 204 * sx, ry);
  }

  // Bottom minimal Rule & PlayStyle+ Crown Emblem
  ctx.strokeStyle = spec.divider;
  ctx.beginPath();
  ctx.moveTo(x + 114 * sx, y + 392 * sy);
  ctx.lineTo(x + 186 * sx, y + 392 * sy);
  ctx.stroke();

  const topPs = card.playstyles[0];
  if (topPs) {
    ctx.textAlign = 'center';
    ctx.fillStyle = spec.textSub;
    ctx.font = `800 ${Math.round(10 * sx)}px system-ui`;
    ctx.fillText(`${topPs.name.toUpperCase()}+`, x + 150 * sx, y + 408 * sy);
  }

  ctx.restore();

  // Crisp Double Metallic Shield Border Rim
  ctx.save();
  traceCurvedShield(ctx, x, y, w, h);
  ctx.lineWidth = Math.max(2.5, 4.5 * sx);
  ctx.strokeStyle = spec.borderOuter;
  ctx.stroke();

  ctx.strokeStyle = spec.borderInner;
  ctx.lineWidth = Math.max(1, 1.4 * sx);
  ctx.stroke();
  ctx.restore();
}

/**
 * Generates and copies/downloads a single FIFA Shield Card PNG with real 3D Rocket League car artwork.
 */
export function exportSingleFifaCardPng(card: FifaCardData, onDone: () => void): void {
  loadCarImage(card.car_body).then(carImg => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 890;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bg = ctx.createRadialGradient(320, 410, 40, 320, 445, 500);
    bg.addColorStop(0, '#16233d');
    bg.addColorStop(1, '#060911');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 640, 890);

    drawFifaShieldOnCanvas(ctx, card, 95, 52, 450, 645, carImg);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '800 15px monospace';
    ctx.fillText(`AER ${card.stats.aer}  ·  DIS ${card.stats.dis}  ·  ${card.total800}/800 TOTAL`, 320, 754);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 14px monospace';
    const cycleText = card.cycle.is_provisional
      ? `PROVISIONAL (${card.cycle.total_matches}/${card.cycle.cycle_size} MATCHES)`
      : `CYCLE #${card.cycle.current_cycle} · MATCHES #${card.cycle.window_start_match}-${card.cycle.window_end_match} · WR ${card.cycle.win_rate}%`;
    ctx.fillText(cycleText, 320, 788);

    ctx.fillStyle = '#475569';
    ctx.font = 'italic 13px system-ui';
    ctx.fillText('OVERTIMERL · UNIFIED FIFA+RL CARD', 320, 838);

    exportCanvasPng(canvas, `overtimerl-card-${card.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, onDone);
  });
}

/**
 * Generates and copies/downloads a 3-Card Trio Formation PNG with Chemistry Links for Discord.
 */
export function exportTrioFormationPng(
  cards: FifaCardData[],
  trio: TrioSquadDossier,
  onDone: () => void
): void {
  Promise.all(cards.slice(0, 3).map(c => loadCarImage(c.car_body))).then(carImgs => {
    const canvas = document.createElement('canvas');
    canvas.width = 1360;
    canvas.height = 760;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bg = ctx.createLinearGradient(0, 0, 1360, 760);
    bg.addColorStop(0, '#070b14');
    bg.addColorStop(0.5, '#0e192d');
    bg.addColorStop(1, '#060911');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1360, 760);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, 1320, 720);

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
      { x: 110, y: 125 },
      { x: 515, y: 105 },
      { x: 920, y: 125 },
    ];

    ctx.strokeStyle = trio.win_rate >= 52 ? '#10b981' : '#f59e0b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(275, 375);
    ctx.lineTo(680, 355);
    ctx.lineTo(1085, 375);
    ctx.stroke();

    cards.slice(0, 3).forEach((card, i) => {
      const pos = positions[i] || positions[0];
      drawFifaShieldOnCanvas(ctx, card, pos.x, pos.y, 330, 473, carImgs[i]);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 16px system-ui';
    ctx.fillText(`3s Core Roster (${trio.matches_together} Mutual Matches) · Powered by OvertimeRL`, 680, 710);

    exportCanvasPng(canvas, 'overtimerl-trio-squad-cards.png', onDone);
  });
}
