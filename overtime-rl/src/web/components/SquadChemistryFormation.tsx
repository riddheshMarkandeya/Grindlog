import React, { useState, useEffect } from 'react';
import type { FifaCardData, TrioSquadDossier } from '../../shared/types.ts';
import { FifaCard } from './FifaCard.tsx';
import { exportTrioFormationPng } from '../utils/fifa-card-canvas.ts';

interface SquadChemistryFormationProps {
  trio: TrioSquadDossier;
  onOpenProfile?: (primaryId: string) => void;
}

/**
 * Renders the 3-Card Ultimate Team Starting Trio Formation with live Chemistry Links
 * (Win Rate, Passing Matrix & Double-Commit Synergy) plus Discord Formation PNG export.
 */
export const SquadChemistryFormation: React.FC<SquadChemistryFormationProps> = ({
  trio,
  onOpenProfile,
}) => {
  const initialCards = trio.players
    .map(p => p.fifa_card)
    .filter((c): c is FifaCardData => Boolean(c));

  const [cards, setCards] = useState<FifaCardData[]>(initialCards);
  const [copiedTrio, setCopiedTrio] = useState(false);

  useEffect(() => {
    setCards(trio.players.map(p => p.fifa_card).filter((c): c is FifaCardData => Boolean(c)));
  }, [trio]);

  if (cards.length === 0) return null;

  const handleCardUpdated = (next: FifaCardData) => {
    setCards(prev => prev.map(c => (c.primary_id === next.primary_id ? next : c)));
  };

  const linkHealthColor =
    trio.win_rate >= 55 && trio.double_commits_per_game <= 1.2
      ? '#34d399'
      : trio.win_rate >= 48
      ? '#fbbf24'
      : '#f87171';

  const getPairLink = (cardA: FifaCardData, cardB: FifaCardData) => {
    const nameA = cardA.player_name;
    const nameB = cardB.player_name;
    const dcPair = trio.intra_double_commits.find(
      p => p.pair.includes(nameA) && p.pair.includes(nameB)
    );
    const passesAB =
      trio.passing_matrix?.find(m => m.passer === nameA && m.receiver === nameB)?.passes ?? 0;
    const passesBA =
      trio.passing_matrix?.find(m => m.passer === nameB && m.receiver === nameA)?.passes ?? 0;
    const chem = trio.pair_chemistry?.find(
      p =>
        (p.player_a.primary_id === cardA.primary_id && p.player_b.primary_id === cardB.primary_id) ||
        (p.player_a.primary_id === cardB.primary_id && p.player_b.primary_id === cardA.primary_id)
    );
    const chemColor = chem
      ? chem.chemistry_score >= 76
        ? '#34d399'
        : chem.chemistry_score >= 64
        ? '#38bdf8'
        : chem.chemistry_score >= 52
        ? '#fbbf24'
        : '#f87171'
      : linkHealthColor;
    return {
      dcs: dcPair?.count ?? chem?.mutual_double_commits ?? 0,
      passes: passesAB + passesBA,
      syn: chem?.chemistry_score ?? null,
      diamonds: chem?.diamonds ?? 0,
      roleFit: chem?.role_pairing_label ?? null,
      color: chemColor,
    };
  };

  const cLeft = cards[0];
  const cMid = cards[1] || cards[0];
  const cRight = cards[2] || cards[0];
  const leftLink = getPairLink(cLeft, cMid);
  const rightLink = getPairLink(cMid, cRight);

  return (
    <div
      className="surface-card"
      style={{
        padding: '24px',
        background:
          'radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.08), rgba(11, 17, 30, 0.92) 70%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#f8fafc', margin: 0 }}>
            🃏 Starting Trio Ultimate Team Formation (15-Game Locked Cards)
          </h3>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Cards refresh automatically after every completed 15-game cycle. Customize car silhouettes or export your full squad lineup to Discord.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            exportTrioFormationPng(cards, trio, () => {
              setCopiedTrio(true);
              setTimeout(() => setCopiedTrio(false), 3000);
            })
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: copiedTrio ? '#10b981' : '#5865F2',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            padding: '9px 16px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(88, 101, 242, 0.35)',
          }}
        >
          {copiedTrio ? '✓ Copied Trio Squad PNG!' : 'Share Squad Cards to Discord'}
        </button>
      </div>

      {/* 3-Card Formation Pitch Grid with Chemistry Connectors */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '12px 4px',
        }}
      >
        <FifaCard
          card={cLeft}
          size="md"
          editable
          showShare
          onCardUpdated={handleCardUpdated}
          onClick={onOpenProfile ? () => onOpenProfile(cLeft.primary_id) : undefined}
        />

        {cards.length >= 2 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              minWidth: '108px',
            }}
          >
            {leftLink.syn !== null && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 900,
                  color: leftLink.color,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  border: `1px solid ${leftLink.color}55`,
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                }}
              >
                {'◆'.repeat(leftLink.diamonds)}{'◇'.repeat(Math.max(0, 3 - leftLink.diamonds))} {leftLink.syn} SYN
              </span>
            )}
            <div style={{ width: '84px', height: '3px', backgroundColor: leftLink.color, borderRadius: '2px', boxShadow: `0 0 8px ${leftLink.color}` }} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: leftLink.color, fontFamily: 'var(--font-mono)' }}>
              {leftLink.passes} PAS · {leftLink.dcs} DCs
            </span>
            {leftLink.roleFit && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {leftLink.roleFit}
              </span>
            )}
          </div>
        )}

        {cards.length >= 2 && (
          <div style={{ transform: 'translateY(-10px)' }}>
            <FifaCard
              card={cMid}
              size="md"
              editable
              showShare
              onCardUpdated={handleCardUpdated}
              onClick={onOpenProfile ? () => onOpenProfile(cMid.primary_id) : undefined}
            />
          </div>
        )}

        {cards.length >= 3 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              minWidth: '108px',
            }}
          >
            {rightLink.syn !== null && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 900,
                  color: rightLink.color,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  border: `1px solid ${rightLink.color}55`,
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                }}
              >
                {'◆'.repeat(rightLink.diamonds)}{'◇'.repeat(Math.max(0, 3 - rightLink.diamonds))} {rightLink.syn} SYN
              </span>
            )}
            <div style={{ width: '84px', height: '3px', backgroundColor: rightLink.color, borderRadius: '2px', boxShadow: `0 0 8px ${rightLink.color}` }} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: rightLink.color, fontFamily: 'var(--font-mono)' }}>
              {rightLink.passes} PAS · {rightLink.dcs} DCs
            </span>
            {rightLink.roleFit && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {rightLink.roleFit}
              </span>
            )}
          </div>
        )}

        {cards.length >= 3 && (
          <FifaCard
            card={cRight}
            size="md"
            editable
            showShare
            onCardUpdated={handleCardUpdated}
            onClick={onOpenProfile ? () => onOpenProfile(cRight.primary_id) : undefined}
          />
        )}
      </div>
    </div>
  );
};
