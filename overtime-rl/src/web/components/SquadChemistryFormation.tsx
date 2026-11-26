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

  const getPairLink = (nameA: string, nameB: string) => {
    const dcPair = trio.intra_double_commits.find(
      p => p.pair.includes(nameA) && p.pair.includes(nameB)
    );
    const passesAB =
      trio.passing_matrix?.find(m => m.passer === nameA && m.receiver === nameB)?.passes ?? 0;
    const passesBA =
      trio.passing_matrix?.find(m => m.passer === nameB && m.receiver === nameA)?.passes ?? 0;
    return {
      dcs: dcPair?.count ?? 0,
      passes: passesAB + passesBA,
    };
  };

  const cLeft = cards[0];
  const cMid = cards[1] || cards[0];
  const cRight = cards[2] || cards[0];
  const leftLink = getPairLink(cLeft.player_name, cMid.player_name);
  const rightLink = getPairLink(cMid.player_name, cRight.player_name);

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
              minWidth: '90px',
            }}
          >
            <div style={{ width: '76px', height: '3px', backgroundColor: linkHealthColor, borderRadius: '2px', boxShadow: `0 0 8px ${linkHealthColor}` }} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: linkHealthColor, fontFamily: 'var(--font-mono)' }}>
              {leftLink.passes} PAS
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {leftLink.dcs} DCs
            </span>
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
              minWidth: '90px',
            }}
          >
            <div style={{ width: '76px', height: '3px', backgroundColor: linkHealthColor, borderRadius: '2px', boxShadow: `0 0 8px ${linkHealthColor}` }} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: linkHealthColor, fontFamily: 'var(--font-mono)' }}>
              {rightLink.passes} PAS
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {rightLink.dcs} DCs
            </span>
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
