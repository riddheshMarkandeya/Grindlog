// What one friend's page and a pair's page share: the back link, the scorebug with both records,
// then two zones: your team (tiles, by playlist, Contribution and your stats with them per mode) and
// the other team (tiles, by playlist, match by match). The friends come as a list and every
// per-person array is you first, then them in that order; one friend is the one-item case. The
// mode and the page of matches are each part's own state.
import { useState } from "react";
import { Link } from "react-router";
import { dayOf } from "../../../shared/periods";
import type { FriendDetail } from "../../../shared/schemas/responses";
import { teammateValue } from "../../../shared/teammate-filter";
import { Contribution, type Who } from "../../components/Contribution";
import { cx } from "../../components/cx";
import { IconLabel } from "../../components/Icon";
import { ModeSwitch } from "../../components/ModeSwitch";
import { PlaylistRecords } from "../../components/PlaylistRecords";
import { Scorebug } from "../../components/Scorebug";
import { Section } from "../../components/Section";
import { Tile, Tiles } from "../../components/Tile";
import { dateLabel, decimal, durationText, plural, whole } from "../../logic/format";
import { decided, diffText, MODE_LABEL, overtimeNote, PAGE_SIZE, pageOf, pickMode, recordLabel, recordText, sideCopy, winPctText, type Mode, type SideCopy } from "../../logic/friends";
import { letter, pct, recapPath } from "../../logic/recap";
import styles from "./Friends.module.css";

type View = FriendDetail["view"];
type WithSide = View["with"];
type AgainstSide = View["against"];
type Row = WithSide["playlists"][number];

const day = (ms: number) => dateLabel(dayOf(ms));
const streakText = (s: WithSide["streak"]) => (s === null ? "–" : `${String(s.length)} ${letter(s.result)}`);

export const BackLink = () => <Link to="/friends" className={styles.back}><IconLabel k="back">Friends</IconLabel></Link>;

export function Bug({ friends, view }: { friends: readonly Who[]; view: View }) {
  const copy = sideCopy(friends.map((f) => f.name));
  const w = view.with.record;
  const a = view.against.record;
  // The h1 names who; the middle holds only the two win %.
  const spoken = (r: typeof w) => (decided(r) === 0 ? recordLabel(r) : `${recordLabel(r)}, ${winPctText(r)} won`);
  return (
    <>
      <Scorebug
        records
        wide
        label={`Together ${spoken(w)}; ${copy.againstLabel} ${spoken(a)}`}
        left={{ label: "TOGETHER", value: recordText(w) }}
        right={{ label: copy.againstLabel.toUpperCase(), value: recordText(a) }}
        mid={
          <>
            <b className="num">{winPctText(w)} · {winPctText(a)}</b>
            <span>WITH · AGAINST</span>
          </>
        }
      />
      <p className={styles.lastLine}>
        Last together {view.with.last === null ? "–" : day(view.with.last)} · last against {view.against.last === null ? "–" : day(view.against.last)}
      </p>
      <p className={styles.private}>
        {friends.length > 1 && "Counts only matches where both were on your team, or both on the other. "}
        Private matches count here; Recap and Trends leave them out unless filtered to Private.
      </p>
    </>
  );
}

export function Zones({ friends, view }: { friends: readonly Who[]; view: View }) {
  const copy = sideCopy(friends.map((f) => f.name));
  const teammate = { friends: friends.map((f) => f.id) };
  return (
    <div className={styles.zones}>
      <Section title={copy.withHeading} tone="yours" className={cx(styles.zone, styles.with)}>
        {/* ?with= matches only friends on your team, so a pair met only as opponents gets no links. */}
        {view.with.record.n === 0 ? (
          <p className="muted">{copy.withEmpty}</p>
        ) : (
          <>
            <WithZone side={view.with} friends={friends} copy={copy} />
            <div className={styles.links}>
              <Link to={recapPath(null, "everything", "overview", teammate)}>Matches with {copy.who} →</Link>
              <Link to={`/trends?with=${encodeURIComponent(teammateValue(teammate) ?? "")}`}>Trends with {copy.who} →</Link>
            </div>
          </>
        )}
      </Section>
      <Section title={copy.againstHeading} tone="theirs" className={cx(styles.zone, styles.against)}>
        {view.against.record.n === 0 ? <p className="muted">{copy.againstEmpty}</p> : <AgainstZone side={view.against} friends={friends} copy={copy} />}
      </Section>
    </div>
  );
}

const Playlists = ({ rows }: { rows: readonly Row[] }) => <PlaylistRecords rows={rows.map((r) => ({ key: r.label, name: r.label, record: r, pct: winPctText(r) }))} />;

// Each zone always shows its six tiles, so the two rows keep their shape; a missing value is "–".
// Best and worst need two playlists with enough decided matches, so many matches can still have none.
const playlistTile = (label: string, r: Row | null) => <Tile label={label} value={r ? winPctText(r) : "–"} note={r ? `${r.label} · ${recordText(r)}` : "not enough yet"} />;
const overtimeTile = (ot: WithSide["overtime"]) => {
  const any = decided(ot) > 0;
  return <Tile label="Overtime" icon="overtime" value={any ? recordText(ot) : "–"} note={any ? overtimeNote(ot) : "none yet"} />;
};

function WithZone({ side, friends, copy }: { side: WithSide; friends: readonly Who[]; copy: SideCopy }) {
  return (
    <>
      <Tiles className={styles.zoneTiles}>
        <Tile label="Current streak" icon="streak" value={streakText(side.streak)} note={copy.withNote} />
        <Tile label="Best win streak" icon="streak" value={String(side.bestWinStreak)} note={copy.withNote} />
        {playlistTile("Best playlist", side.best)}
        {playlistTile("Worst playlist", side.worst)}
        <Tile label="Time together" icon="time" value={durationText(side.timeMs)} note={`over ${plural(decided(side.record), "match", "matches")}`} />
        {overtimeTile(side.overtime)}
      </Tiles>
      <Section level={3} region={false} title="By playlist"><Playlists rows={side.playlists} /></Section>
      {side.defaultMode !== null && <Modes side={side} defaultMode={side.defaultMode} friends={friends} copy={copy} />}
    </>
  );
}

function Modes({ side, defaultMode, friends, copy }: { side: WithSide; defaultMode: Mode; friends: readonly Who[]; copy: SideCopy }) {
  const modes = side.modes.map((m) => m.mode);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode = pickMode(modes, defaultMode, picked);
  const view = side.modes.find((m) => m.mode === mode);
  if (!view) return null;
  return (
    <Section
      level={3} title="Contribution · stats with them"
      aside={modes.length === 1 ? <span className="muted">{MODE_LABEL[mode]}</span> : <ModeSwitch modes={modes} mode={mode} pick={setPicked} />}
    >
      <Contribution carry={view.carry} mode={mode} friends={friends} scope={copy.together} />
      <Compare compare={view.compare} mode={mode} friends={friends} copy={copy} />
    </Section>
  );
}

/** A friend's name over a column, cut with an ellipsis; a table cell ignores max-width itself. */
const Cap = ({ name }: { name: string }) => <span className={styles.cap} title={name}>{name}</span>;

type CompareView = WithSide["modes"][number]["compare"];
const STATS = [["score", "Score"], ["goals", "Goals"], ["assists", "Assists"], ["saves", "Saves"], ["shots", "Shots"]] as const;

function Compare({ compare, mode, friends, copy }: { compare: CompareView; mode: Mode; friends: readonly Who[]; copy: SideCopy }) {
  const { with: w, without: wo } = compare;
  const diff = (a: number | undefined, b: number | undefined, points = false) => {
    if (a === undefined || b === undefined) return <td className="muted">–</td>;
    const { text, dir } = diffText(a, b, points);
    return <td className={dir > 0 ? "up" : dir < 0 ? "down" : "muted"}>{text}</td>;
  };
  const winOf = (p: number | null | undefined) => (p === null || p === undefined ? undefined : pct(p));
  const ww = winOf(w.winPct);
  const wow = winOf(wo?.winPct);
  const sep = (i: number) => (i === 0 ? styles.sep : undefined);
  return (
    <div className="panel">
      {/* Focusable, so a keyboard can scroll the table sideways on a narrow screen. */}
      <div className={styles.tw} role="region" aria-label="Contribution, per match" tabIndex={0}>
        <table className="table num">
          <thead>
            <tr>
              <th scope="col">Per match</th>
              <th scope="col">{copy.withColumn}</th>
              <th scope="col">Other matches</th>
              <th scope="col">Diff</th>
              {friends.map((f, i) => <th key={f.id} scope="col" className={sep(i)}><Cap name={f.name} /></th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Win %</th>
              <td>{ww === undefined ? "–" : `${String(ww)}%`}</td>
              <td className="muted">{wow === undefined ? "–" : `${String(wow)}%`}</td>
              {diff(ww, wow, true)}
              {/* Empty, not "–": a friend's win % is the same as yours together, so there's nothing to add. */}
              {friends.map((f, i) => <td key={f.id} className={sep(i)} />)}
            </tr>
            {STATS.map(([k, label]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td>{decimal(w[k])}</td>
                <td className="muted">{wo ? decimal(wo[k]) : "–"}</td>
                {diff(w[k], wo?.[k])}
                {friends.map((f, i) => {
                  const them = compare.friends[i];
                  return <td key={f.id} className={sep(i)}>{them ? decimal(them[k]) : "–"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        {copy.compareNote(MODE_LABEL[mode], w.matches, wo?.matches ?? 0)}
        {mode.startsWith("p") ? " Uneven private lobbies are left out." : " Private matches are left out of both."} {copy.theirColumns}
      </p>
    </div>
  );
}

function AgainstZone({ side, friends, copy }: { side: AgainstSide; friends: readonly Who[]; copy: SideCopy }) {
  return (
    <>
      <Tiles className={styles.zoneTiles}>
        <Tile label="Current streak" icon="streak" value={streakText(side.streak)} note={copy.againstNote} />
        <Tile label="MVPs" icon="mvp" value={side.mvps.join("–")} note={copy.versus} noteLines={2} />
        <Tile label="Goals" icon="goal" value={side.goals.join("–")} note={copy.versus} noteLines={2} />
        <Tile label="Biggest win" value={side.biggestWin ? `+${String(side.biggestWin.goalDiff)}` : "–"} note={side.biggestWin ? `${day(side.biggestWin.startedAt)} · ${side.biggestWin.label}` : side.record.w > 0 ? "no score kept" : "no wins yet"} />
        {overtimeTile(side.overtime)}
        <Tile label="Matches" icon="matches" value={whole(decided(side.record))} note={copy.againstNote} />
      </Tiles>
      <Section level={3} region={false} title="By playlist"><Playlists rows={side.playlists} /></Section>
      <Section level={3} region={false} title="Match by match"><Matches matches={side.matches} friends={friends} /></Section>
    </>
  );
}

const COLS = [["score", "Sc", "Score"], ["goals", "G", "Goals"], ["assists", "A", "Assists"], ["saves", "Sv", "Saves"], ["shots", "Sh", "Shots"]] as const;
type Match = AgainstSide["matches"][number];

function Matches({ matches, friends }: { matches: AgainstSide["matches"]; friends: readonly Who[] }) {
  const [asked, setAsked] = useState(0);
  const { rows, page, pages } = pageOf(matches, asked);
  const first = page * PAGE_SIZE + 1;
  const go = (to: number) => { if (to >= 0 && to < pages) setAsked(to); };
  // A column group per person, in the match lines' order: 0 is you, i + 1 is friend i.
  const groups = [
    { key: "me", name: "You", cls: styles.you, line: (m: Match) => m.me, star: "Your MVP" },
    ...friends.map((f, i) => ({ key: f.id, name: f.name, cls: styles.opp, line: (m: Match) => m.friends[i], star: `${f.name}'s MVP` })),
  ];
  return (
    <div className="panel">
      <div className={styles.tw} role="region" aria-label="Match by match" tabIndex={0}>
        <table className="table num">
          <thead>
            <tr>
              <td />
              <td />
              {groups.map((g, gi) => <th key={g.key} scope="colgroup" colSpan={5} className={cx(gi > 0 && styles.sep, g.cls)}>{gi > 0 ? <Cap name={g.name} /> : g.name}</th>)}
            </tr>
            <tr>
              <th scope="col">Match</th>
              <th scope="col"><span className="visually-hidden">Result</span></th>
              {groups.map((g, gi) => COLS.map(([k, short, long], i) => <th key={`${g.key}-${k}`} scope="col" className={gi > 0 && i === 0 ? styles.sep : undefined}><abbr title={long}>{short}</abbr></th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.guid}>
                <td>
                  {m.sessionKey === null ? day(m.startedAt) : (
                    <Link to={recapPath(m.sessionKey, m.playlistId === null ? "everything" : { playlist: m.playlistId }, { match: m.guid })}>{day(m.startedAt)}</Link>
                  )}{" "}
                  <span className="muted">{m.label}</span>
                </td>
                <td className={m.result === "win" ? styles.w : m.result === "loss" ? styles.l : "muted"}>{letter(m.result)}</td>
                {groups.map((g, gi) => {
                  const line = g.line(m);
                  return COLS.map(([k], i) => {
                    const v = line?.[k];
                    return (
                      <td key={`${g.key}-${k}`} className={gi > 0 && i === 0 ? styles.sep : undefined}>
                        {v === undefined ? null : whole(v)}{i === 0 && m.mvp === gi && <span title={g.star}> ★</span>}
                      </td>
                    );
                  });
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className={styles.pager}>
          <button type="button" className={cx("button", styles.nowrap)} aria-disabled={page === 0} onClick={() => { go(page - 1); }}>← Newer</button>
          <span className="muted" aria-live="polite">{whole(first)}–{whole(first + rows.length - 1)} of {whole(matches.length)}</span>
          <button type="button" className={cx("button", styles.nowrap)} aria-disabled={page === pages - 1} onClick={() => { go(page + 1); }}>Older →</button>
        </div>
      )}
      <p className={styles.note}>★ MVP. Newest first, 10 a page; a date opens the match.</p>
    </div>
  );
}
