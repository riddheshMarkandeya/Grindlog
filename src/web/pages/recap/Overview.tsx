// The recap's Overview: scorebug, the remarks and the change against the 30-day average, the
// tiles, the match cards, per-game stats (the stats that stood out marked "!"), then the goal map
// beside by playlist, Contribution and the touches, then extras and highlights.
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { filterValue, type PlaylistFilter } from "../../../shared/playlist-filter";
import { teammateValue, type TeammateFilter } from "../../../shared/teammate-filter";
import { matchClutch } from "../../../shared/clutch";
import { playlistInfo } from "../../../shared/playlists";
import type { AggregateWire, Goal, MyMatchWire, SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { GoalMap } from "../../components/GoalMap";
import { Icon } from "../../components/Icon";
import { Section } from "../../components/Section";
import { Scorebug } from "../../components/Scorebug";
import { StatCard, StatCards } from "../../components/StatCard";
import { Tile, Tiles, VsText } from "../../components/Tile";
import { clock, dayLabel, decimal, durationText, plural, whole } from "../../logic/format";
import {
  clutchStory,
  lateWinnerMark,
  extrasCards,
  highlights,
  isDense,
  isMyMvp,
  letter,
  matchLabel,
  pct,
  perGameCards,
  playlistRows,
  recapPath,
  scoreFor,
  stoodOut,
  stoodOutNote,
  tilesFor,
  vsAvgText,
  winPctVs,
} from "../../logic/recap";
import { fillRemark } from "../../logic/remarks";
import { useRemarks, useRerollRemarks, useSettings } from "../../queries";
import styles from "./Overview.module.css";
import { ContributionSections, PlaylistBars } from "./SessionShares";

export function Overview({ detail, summary, filter, teammate }: { detail: SessionDetail; summary: SessionSummary; filter: PlaylistFilter; teammate: TeammateFilter }) {
  const matchPath = (guid: string) => recapPath(detail.key, filter, { match: guid }, teammate);
  return (
    <>
      <RecapScorebug detail={detail} summary={summary} />
      <Headline detail={detail} filter={filter} teammate={teammate} />
      <MatchCards matches={detail.matches} goals={detail.goals} matchPath={matchPath} />
      <PerGame detail={detail} />
      <GoalsAndShares detail={detail} teammate={teammate} matchPath={matchPath} />
      <ExtrasSection agg={detail.aggregate} matches={detail.matches} heading="Extras" />
    </>
  );
}

function RecapScorebug({ detail, summary }: { detail: SessionDetail; summary: SessionSummary }) {
  const winPct = detail.aggregate.winPct;
  return (
    <Scorebug
      label={`${plural(summary.wins, "win")}, ${plural(summary.losses, "loss", "losses")}`}
      left={{ label: "WINS", value: String(summary.wins) }}
      right={{ label: "LOSSES", value: String(summary.losses) }}
      mid={
        <>
          <span>{dayLabel(detail.day).toUpperCase()}</span>
          <b>{durationText(detail.endedAt - detail.startedAt)}</b>
          <span className="num">{winPct !== null && `${String(pct(winPct))}% · `}{plural(summary.matches, "MATCH", "MATCHES")}</span>
        </>
      }
    />
  );
}

/**
 * The mood line, ↻, and the quip. Absent while loading or when they can't be fetched: the rest of
 * the headline doesn't wait. With the mood line switched off, ↻ follows the quip; with no quip
 * either, there's nothing to show.
 */
function Remarks({ sessionKey, filter, teammate }: { sessionKey: string; filter: PlaylistFilter; teammate: TeammateFilter }) {
  const settings = useSettings();
  const { data } = useRemarks(sessionKey, filter, teammate);
  const reroll = useRerollRemarks(sessionKey, filter, teammate);
  if (!data) return null;
  const quip = data.quip && fillRemark(data.quip.text, data.quip.values, settings);
  if (!settings.moodLine && !quip) return null;
  // aria-disabled, not disabled: a disabled button drops keyboard focus mid-reroll.
  const again = () => {
    if (!reroll.isPending) reroll.mutate();
  };
  const controls = (
    <>
      {" "}
      <button type="button" className={styles.reroll} aria-label="Another remark" title="Another remark" aria-disabled={reroll.isPending} onClick={again}>↻</button>
      {reroll.isError && (
        <span className={styles.rerollError}>
          Couldn't re-roll · <button type="button" className={styles.retry} onClick={again}>Retry</button>
        </span>
      )}
    </>
  );
  return (
    <div aria-live="polite">
      {settings.moodLine && <p className={styles.mood}>{data.mood.text}{controls}</p>}
      {quip && <p className={styles.quip}>{quip}{!settings.moodLine && controls}</p>}
    </div>
  );
}

function Headline({ detail, filter, teammate }: { detail: SessionDetail; filter: PlaylistFilter; teammate: TeammateFilter }) {
  // Off, the lines aren't fetched either, so no pick is stored for a headline nobody saw.
  const { remarks } = useSettings();
  const winVs = winPctVs(detail.aggregate, detail.baseline);
  const tiles = tilesFor(detail.aggregate, detail.baseline);
  return (
    <div className={styles.sub}>
      {/* Keyed so a reroll's pending or failed state doesn't follow you to another session. */}
      {remarks && <Remarks key={`${detail.key}|${filterValue(filter)}|${teammateValue(teammate) ?? ""}`} sessionKey={detail.key} filter={filter} teammate={teammate} />}
      {winVs && <p className={styles.delta}>Win % <VsText vs={winVs} /></p>}
      {tiles.length > 0 && (
        <Tiles>
          {tiles.map((t) => (
            <Tile key={t.id} label={t.label} value={t.value} icon={t.icon} vs={t.vs && vsAvgText(t.vs.dir, `${String(Math.abs(t.vs.points))} pts`, t.vs.avg)} />
          ))}
        </Tiles>
      )}
    </div>
  );
}

function MatchCards({ matches, goals, matchPath }: { matches: MyMatchWire[]; goals: Goal[]; matchPath: (guid: string) => string }) {
  const { clock: hours } = useSettings();
  return (
    <Section title="Matches" aside={<span className={cx("muted", styles.small)}>Results in order</span>}>
      <ol className={cx(styles.cards, isDense(matches.length) && styles.dense)}>
        {matches.map((m, i) => {
          const score = scoreFor(m);
          const mvp = isMyMvp(m);
          const playlist = playlistInfo(m.playlistId).name;
          const c = matchClutch(m, goals);
          const story = clutchStory(c);
          const late = lateWinnerMark(c);
          return (
            <li key={m.guid}>
              <Link to={matchPath(m.guid)} className={cx(styles.card, m.result === "win" && styles.win, m.result === "loss" && styles.loss, m.flags.length > 0 && styles.flagged, late !== null && styles.hasLate)} aria-label={matchLabel(m, i + 1, hours, story?.label, late?.label)}>
                <span className={styles.t} aria-hidden="true">#{i + 1} · {clock(m.startedAt, hours)}</span>
                <b className="num display" aria-hidden="true"><i>{letter(m.result)}</i> {score}</b>
                <span className={styles.p} aria-hidden="true" title={playlist}>{playlist}</span>
                {story && <span className={cx(styles.story, story.tone !== null && styles[story.tone])} aria-hidden="true" title={story.text}>{story.text}</span>}
                {mvp && <Icon k="mvp" className={styles.mvp} />}
                {late && (
                  <span className={cx(styles.late, styles[late.tone])} aria-hidden="true" title={late.title}>
                    <Icon k="time" />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}


/**
 * A stood-out stat's "!": a toggletip. A mouse over the glyph or the note shows it; a click or tap
 * pins it open until the next click, a click or tap elsewhere, blur or Escape, and Escape also hides
 * a hovered note. The note is always in the DOM as the button's description; it's laid out against
 * the card, not the glyph, so it fits the narrowest card.
 */
function StoodOutMark({ dir, note }: { dir: "up" | "down"; note: string }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const shown = pinned || hovered;
  const tipId = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!shown) return;
    const close = () => { setPinned(false); setHovered(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // Safari doesn't focus a clicked button, so blur alone wouldn't close it there.
    const onDown = (e: PointerEvent) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) setPinned(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [shown]);
  // A touch also sends pointerenter; only a mouse hovers.
  const hover = (on: boolean) => (e: ReactPointerEvent) => { if (e.pointerType === "mouse") setHovered(on); };
  return (
    <span ref={ref} className={styles.mark} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button
        type="button" className={cx(styles.bang, dir)} aria-label="Stood out" aria-describedby={tipId} aria-expanded={shown}
        onClick={() => { setPinned((o) => !o); }} onBlur={() => { setPinned(false); }}
      >
        <span aria-hidden="true">!</span>
      </button>
      <span id={tipId} className={cx(styles.tip, shown && styles.open)}>{note}</span>
    </span>
  );
}

function PerGameCards({ cards, detail }: { cards: ReturnType<typeof perGameCards>; detail: SessionDetail }) {
  // Their rank in stoodOut()'s order, biggest first; none without a baseline or when nothing moved 10%.
  const rank = new Map((stoodOut(detail.aggregate, detail.baseline) ?? []).map((s, i) => [s.id, i]));
  return (
    <StatCards>
      {cards.map((c) => {
        const r = rank.get(c.id);
        return (
          <StatCard
            key={c.id} label={c.label} icon={c.icon} value={decimal(c.perGame)} unit=" /game" sub={`${whole(c.total)} total`}
            vs={c.vs && c.avg !== null && <VsText vs={vsAvgText(c.vs.dir, `${String(Math.abs(c.vs.pct))}%`, decimal(c.avg))} />}
            mark={r !== undefined && c.vs && <StoodOutMark dir={c.vs.pct < 0 ? "down" : "up"} note={stoodOutNote(r, c.vs)} />}
          />
        );
      })}
    </StatCards>
  );
}

function PerGame({ detail }: { detail: SessionDetail }) {
  const cards = perGameCards(detail.aggregate, detail.baseline);
  if (!cards.length) return null;
  return (
    <Section title={detail.baseline.matches > 0 ? "Per game vs your 30-day average" : "Per game"}>
      <PerGameCards cards={cards} detail={detail} />
    </Section>
  );
}

/**
 * The goal map at about 3/5 width and, beside it, By playlist (two playlists or more) then
 * Contribution and the touches (a session with a mode). Either side alone takes the full width.
 */
function GoalsAndShares({ detail, teammate, matchPath }: { detail: SessionDetail; teammate: TeammateFilter; matchPath: (guid: string) => string }) {
  const rows = playlistRows(detail.byPlaylist);
  const c = detail.contribution;
  const goals = detail.goals.length > 0;
  const right = rows !== null || c !== null;
  if (!goals && !right) return null;
  // The teammate filter's friends in its order, which is the order of the per-person shares.
  const names = new Map(detail.friendsPresent.map((f) => [f.id, f.name]));
  const friends = typeof teammate === "object" ? teammate.friends.map((id) => ({ id, name: names.get(id) ?? "Friend" })) : [];
  return (
    <div className={cx(styles.middle, goals && right && styles.both)}>
      {goals && (
        <Section title="Where the goals came from" className={styles.cell}>
          <div className="panel">
            <GoalMap matches={detail.matches} goals={detail.goals} viewKey={detail.key} hrefFor={matchPath} />
          </div>
        </Section>
      )}
      {right && (
        <div className={styles.col}>
          {rows !== null && <PlaylistBars rows={rows} />}
          {/* Keyed by session: the mode pick survives a filter change, not a move to another session. */}
          {c !== null && <ContributionSections key={detail.key} contribution={c} friends={friends} />}
        </div>
      )}
    </div>
  );
}

/** The extras tiles and highlights over these matches; the Overview's "Extras", a match page's "Your match". */
export function ExtrasSection({ agg: a, matches, heading }: { agg: AggregateWire; matches: MyMatchWire[]; heading: string }) {
  const cards = extrasCards(a, matches, useSettings());
  const hl = highlights(a.statfeed);
  if (!cards.length && !hl.length) return null;
  return (
    <Section title={heading}>
      {a.extrasMatches > 0 && a.extrasMatches < a.matches && (
        <p className={cx("muted", styles.small)}>Over {a.extrasMatches} of {plural(a.matches, "match", "matches")}.</p>
      )}
      {cards.length > 0 && (
        <StatCards>
          {cards.map((c) => (
            <StatCard key={c.id} label={c.label} icon={c.icon} value={c.value} unit={c.unit && (c.unit === "%" ? "%" : ` ${c.unit}`)} sub={c.sub} />
          ))}
        </StatCards>
      )}
      {hl.length > 0 && (
        <Section level={3} title="Highlights">
          <StatCards>
            {hl.map((h) => <StatCard key={h.event} label={h.label} value={whole(h.count)} />)}
          </StatCards>
        </Section>
      )}
    </Section>
  );
}
