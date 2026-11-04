// The recap's Overview: scorebug, the remarks and the change against the 30-day average, the
// tiles, the match cards, then per-game stats, what stood out, by playlist, the goal map, extras
// and highlights.
import { Link } from "react-router";
import { filterValue, type PlaylistFilter } from "../../../shared/playlist-filter";
import { teammateValue, type TeammateFilter } from "../../../shared/teammate-filter";
import { playlistInfo } from "../../../shared/playlists";
import type { AggregateWire, MyMatchWire, SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import assistIcon from "../../assets/icons/Assist.png";
import demoIcon from "../../assets/icons/Demolition.png";
import goalIcon from "../../assets/icons/Goal.png";
import mvpIcon from "../../assets/icons/MVP.png";
import saveIcon from "../../assets/icons/Save.png";
import shotIcon from "../../assets/icons/Shot.png";
import { cx } from "../../components/cx";
import { DirArrow } from "../../components/DirArrow";
import { GoalMap } from "../../components/GoalMap";
import { Section } from "../../components/Section";
import { Scorebug } from "../../components/Scorebug";
import { StatCard, StatCards } from "../../components/StatCard";
import { Tile, Tiles } from "../../components/Tile";
import { clock, dayLabel, decimal, durationText, plural, whole } from "../../logic/format";
import {
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
  tilesFor,
  winPctDelta,
  type IconName,
  type Vs,
} from "../../logic/recap";
import { fillRemark } from "../../logic/remarks";
import { useRemarks, useRerollRemarks, useSettings } from "../../queries";
import styles from "./Overview.module.css";

export function Overview({ detail, summary, filter, teammate }: { detail: SessionDetail; summary: SessionSummary; filter: PlaylistFilter; teammate: TeammateFilter }) {
  const matchPath = (guid: string) => recapPath(detail.key, filter, { match: guid }, teammate);
  return (
    <>
      <RecapScorebug detail={detail} summary={summary} />
      <Headline detail={detail} filter={filter} teammate={teammate} />
      <MatchCards matches={detail.matches} matchPath={matchPath} />
      <PerGame detail={detail} />
      <StandoutAndPlaylists detail={detail} />
      {detail.goals.length > 0 && (
        <Section title="Where the goals came from">
          <div className="panel">
            <GoalMap matches={detail.matches} goals={detail.goals} viewKey={detail.key} hrefFor={matchPath} />
          </div>
        </Section>
      )}
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
  const delta = winPctDelta(detail.aggregate, detail.baseline);
  const tiles = tilesFor(detail.aggregate, detail.baseline);
  return (
    <div className={styles.sub}>
      {/* Keyed so a reroll's pending or failed state doesn't follow you to another session. */}
      {remarks && <Remarks key={`${detail.key}|${filterValue(filter)}|${teammateValue(teammate) ?? ""}`} sessionKey={detail.key} filter={filter} teammate={teammate} />}
      {delta && (
        <p className={styles.delta}>
          {delta.points === 0 ? (
            "Level with your 30-day win %"
          ) : (
            <span className={delta.points > 0 ? "up" : "down"}><DirArrow dir={delta.points > 0 ? "up" : "down"} /> {Math.abs(delta.points)} pts win % vs your 30-day average</span>
          )}{" "}
          <span className="muted">({delta.avg}%)</span>
        </p>
      )}
      {tiles.length > 0 && (
        <Tiles>
          {tiles.map((t) => (
            <Tile key={t.id} label={t.label} value={t.value} icon={t.id === "mvps" ? mvpIcon : undefined} vs={t.vs && { dir: t.vs.dir, text: `avg ${t.vs.avg}` }} />
          ))}
        </Tiles>
      )}
    </div>
  );
}

function MatchCards({ matches, matchPath }: { matches: MyMatchWire[]; matchPath: (guid: string) => string }) {
  const { clock: hours } = useSettings();
  return (
    <Section title="Matches" aside={<span className={cx("muted", styles.small)}>Results in order</span>}>
      <ol className={cx(styles.cards, isDense(matches.length) && styles.dense)}>
        {matches.map((m, i) => {
          const score = scoreFor(m);
          const mvp = isMyMvp(m);
          const playlist = playlistInfo(m.playlistId).name;
          return (
            <li key={m.guid}>
              <Link to={matchPath(m.guid)} className={cx(styles.card, m.result === "win" && styles.win, m.result === "loss" && styles.loss, m.flags.length > 0 && styles.flagged)} aria-label={matchLabel(m, i + 1, hours)}>
                <span className={styles.t} aria-hidden="true">#{i + 1} · {clock(m.startedAt, hours)}</span>
                <b className="num display" aria-hidden="true"><i>{letter(m.result)}</i> {score}</b>
                <span className={styles.p} aria-hidden="true" title={playlist}>{playlist}</span>
                {mvp && <img className={styles.mvp} src={mvpIcon} alt="" />}
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

const ICONS: Record<IconName, string> = { Goal: goalIcon, Assist: assistIcon, Save: saveIcon, Shot: shotIcon, Demolition: demoIcon };

/** "▲ 12%" with the direction in words for screen readers, or "≈ 30-day avg". */
function VsText({ vs }: { vs: Vs }) {
  if (vs.dir === "same") return <span className="muted">≈ 30-day avg</span>;
  return (
    <span className={vs.dir}>
      <DirArrow dir={vs.dir} /> {Math.abs(vs.pct)}%
    </span>
  );
}

function PerGame({ detail }: { detail: SessionDetail }) {
  const cards = perGameCards(detail.aggregate, detail.baseline);
  if (!cards.length) return null;
  const hasBase = detail.baseline.matches > 0;
  return (
    <Section title={hasBase ? "Per game vs your 30-day average" : "Per game"}>
      <StatCards>
        {cards.map((c) => (
          <StatCard
            key={c.id} label={c.label} icon={c.icon && ICONS[c.icon]} value={decimal(c.perGame)} unit=" /game" sub={`${whole(c.total)} total`}
            vs={c.vs && <><VsText vs={c.vs} />{c.vs.dir !== "same" && <span className="muted"> vs 30-day avg</span>}</>}
          />
        ))}
      </StatCards>
    </Section>
  );
}

function StandoutAndPlaylists({ detail }: { detail: SessionDetail }) {
  const stood = stoodOut(detail.aggregate, detail.baseline);
  const rows = playlistRows(detail.byPlaylist);
  if (stood === null && rows === null) return null;
  return (
    <div className={styles.grid2}>
      {stood !== null && (
        <Section title="What stood out" className={styles.cell}>
          <div className="panel">
            {stood.length === 0 ? (
              <p className="muted">Close to your 30-day average on every stat.</p>
            ) : (
              <ul className={styles.stand}>
                {stood.map((s) => (
                  <li key={s.id}>
                    {s.icon ? <img className={styles.bIco} src={ICONS[s.icon]} alt="" /> : <span />}
                    <div>
                      <b className="num">{decimal(s.perGame)} {s.label.toLowerCase()} per game</b>
                      <div className="num"><VsText vs={s.vs} /> <span className="muted">vs 30-day avg ({decimal(s.avg)})</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}
      {rows !== null && (
        <Section title="By playlist" className={styles.cell}>
          <div className="panel">
            <table className="table num">
              <thead><tr><th scope="col">Playlist</th><th scope="col">W–L</th><th scope="col">Win %</th><th scope="col">Goals/g</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.playlistId)}>
                    <th scope="row">{r.name}</th>
                    <td>{r.wins === null || r.losses === null ? "–" : `${String(r.wins)}–${String(r.losses)}`}</td>
                    <td>{r.winPct === null ? "–" : `${String(r.winPct)}%`}</td>
                    <td>{r.goalsPerGame === null ? "–" : decimal(r.goalsPerGame)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
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
            <StatCard key={c.id} label={c.label} value={c.value} unit={c.unit && (c.unit === "%" ? "%" : ` ${c.unit}`)} sub={c.sub} />
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
