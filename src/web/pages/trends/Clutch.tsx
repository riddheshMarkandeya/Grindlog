// The Trends "Clutch" section: close games, overtime, late winners and late goals, who scored first, goals
// answered within seconds, comebacks and blown leads, forfeits, then win % by the biggest deficit and lead a
// match reached. It follows the period and both filters; the numbers come with the period
// (shared/clutch.ts) and the text from logic/clutch.ts.
import { Link } from "react-router";
import { LATE_SECONDS, type WL } from "../../../shared/clutch";
import type { PeriodView } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { Section } from "../../components/Section";
import { Tile, Tiles } from "../../components/Tile";
import { WlBar } from "../../components/WlBar";
import { clutchTiles, rungLabel, swingLink, swingText, type LadderSide } from "../../logic/clutch";
import { recordLabel, recordText, winPctText } from "../../logic/friends";
import type { TrendsState } from "../../logic/trends";
import styles from "./Clutch.module.css";

const INTRO = `How your team does when it's tight or the lead swings: every number here counts your team's goals and results, not just yours. A comeback or blown lead means ${swingText} goals down or up at some point; a 1-goal deficit happens in almost every match, so it isn't counted. Every match counts, forfeits included. Late means the last ${String(LATE_SECONDS)} s of regular match time; overtime goals are never late. Casual, ranked and tournament playlists only.`;

const SIDES = {
  down: { title: "Win % by the most you trailed by", hint: "Each match counted once, at its biggest deficit." },
  up: { title: "Win % by the most you led by", hint: "Each match counted once, at its biggest lead." },
} as const;

export function Clutch({ view, state }: { view: PeriodView; state: Pick<TrendsState, "filter" | "teammate"> }) {
  const c = view.clutch;
  return (
    <Section level={3} title="Clutch" intro={INTRO}>
      {c === null ? (
        <p className="muted">No casual, ranked or tournament matches here.</p>
      ) : (
        <>
          <Tiles>
            {clutchTiles(c).map((t) => <Tile key={t.label} label={t.label} icon={t.icon} value={t.value} note={t.note} noteLines={2} />)}
          </Tiles>
          <div className={cx("panel", styles.ladders)}>
            {(["down", "up"] as const).map((side) => <Ladder key={side} side={side} rungs={c.ladder[side]} link={swingLink(c, side, state.filter, state.teammate)} />)}
          </div>
        </>
      )}
    </Section>
  );
}

function Ladder({ side, rungs, link }: { side: LadderSide; rungs: readonly WL[]; link: ReturnType<typeof swingLink> }) {
  return (
    <div>
      <h4 className={styles.title}>{SIDES[side].title}</h4>
      <p className={styles.hint}>{SIDES[side].hint}</p>
      <ul className={styles.rungs}>
        {rungs.map((r, i) => (
          <li key={i} className={styles.rung}>
            <span>{rungLabel(side, i)}</span>
            <WlBar w={r.w} l={r.l} className={styles.bar} />
            <span className="num">{winPctText(r)}</span>
            <span className="num muted">
              <span aria-hidden="true">{recordText(r)}</span>
              <span className="visually-hidden">{recordLabel(r)}</span>
            </span>
          </li>
        ))}
      </ul>
      {link && (
        <Link to={link.path} className={styles.swing}>
          {link.text} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
