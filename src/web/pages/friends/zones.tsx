// What one friend's page and a pair's page share: the back link, the scorebug with both records,
// then two zones: your team (tiles, by playlist, who carries and your stats with them per mode) and
// the other team (tiles, by playlist, match by match). The friends come as a list and every
// per-person array is you first, then them in that order; one friend is the one-item case. The
// mode and the page of matches are each part's own state.
import { useState } from "react";
import { Link } from "react-router";
import { dayOf } from "../../../shared/periods";
import type { FriendDetail } from "../../../shared/schemas/responses";
import { teammateValue } from "../../../shared/teammate-filter";
import { cx } from "../../components/cx";
import { Scorebug } from "../../components/Scorebug";
import { Section } from "../../components/Section";
import { Tile, Tiles } from "../../components/Tile";
import { dateLabel, decimal, durationText, plural, whole } from "../../logic/format";
import { carryRest, carryShares, diffText, modeSwitch, OTHERS, overtimeNote, PAGE_SIZE, pageOf, pickKind, pickMode, pickSize, recordText, sideCopy, sizeOf, winPctText, type Mode, type SideCopy } from "../../logic/friends";
import { letter, pct, recapPath } from "../../logic/recap";
import styles from "./Friends.module.css";
import { recordLabel, WlBar } from "./parts";

export interface Who { id: string; name: string }
type View = FriendDetail["view"];
type WithSide = View["with"];
type AgainstSide = View["against"];
type Row = WithSide["playlists"][number];

const MODE_LABEL: Record<Mode, string> = { "2": "2v2", "3": "3v3", "4": "4v4", p2: "Private 2v2", p3: "Private 3v3" };
// Friend i's colour in the carry bars and its legend; the pages build pairs at most.
const SHADES = [styles.friendA, styles.friendB];
const day = (ms: number) => dateLabel(dayOf(ms));
const streakText = (s: WithSide["streak"]) => (s === null ? "–" : `${String(s.length)} ${letter(s.result)}`);

export const BackLink = () => <Link to="/friends" className={styles.back}>← Friends</Link>;

export function Bug({ friends, view }: { friends: readonly Who[]; view: View }) {
  const copy = sideCopy(friends.map((f) => f.name));
  const w = view.with.record;
  const a = view.against.record;
  return (
    <>
      <Scorebug
        records
        label={`Together ${recordLabel(w)}; ${copy.againstLabel} ${recordLabel(a)}`}
        left={{ label: "TOGETHER", value: recordText(w) }}
        right={{ label: copy.againstLabel.toUpperCase(), value: recordText(a) }}
        mid={
          <>
            <span className={styles.mid} title={copy.title}>{copy.title.toUpperCase()}</span>
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

function Playlists({ rows }: { rows: readonly Row[] }) {
  return (
    <div className="panel">
      {rows.map((r) => (
        <div key={r.label} className={styles.pl}>
          <span className={styles.trunc} title={r.label}>{r.label}</span>
          <span className={cx(styles.r, "num")}><span aria-hidden="true">{recordText(r)}</span><span className="visually-hidden">{recordLabel(r)}</span></span>
          <WlBar w={r.w} l={r.l} />
          <span className={cx(styles.r, "muted", "num")}>{winPctText(r)}</span>
        </div>
      ))}
    </div>
  );
}

const playlistNote = (r: Row) => `${r.label} · ${recordText(r)}`;
const overtimeTile = (ot: WithSide["overtime"]) => ot.w + ot.l > 0 && <Tile label="Overtime" value={recordText(ot)} note={overtimeNote(ot)} />;

function WithZone({ side, friends, copy }: { side: WithSide; friends: readonly Who[]; copy: SideCopy }) {
  return (
    <>
      <Tiles className={styles.zoneTiles}>
        <Tile label="Current streak" value={streakText(side.streak)} note={copy.withNote} />
        <Tile label="Best win streak" value={String(side.bestWinStreak)} note={copy.withNote} />
        {side.best && <Tile label="Best playlist" value={winPctText(side.best)} note={playlistNote(side.best)} />}
        {side.worst && <Tile label="Worst playlist" value={winPctText(side.worst)} note={playlistNote(side.worst)} />}
        <Tile label="Time together" value={durationText(side.timeMs)} note={`over ${plural(side.record.n, "match", "matches")}`} />
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
      level={3} title="Who carries · stats with them"
      aside={modes.length === 1 ? <span className="muted">{MODE_LABEL[mode]}</span> : <ModeSwitch modes={modes} mode={mode} pick={setPicked} />}
    >
      <Carry carry={view.carry} mode={mode} friends={friends} copy={copy} />
      <Compare compare={view.compare} mode={mode} friends={friends} copy={copy} />
    </Section>
  );
}

function ModeSwitch({ modes, mode, pick }: { modes: readonly Mode[]; mode: Mode; pick: (m: Mode) => void }) {
  const sw = modeSwitch(modes, mode);
  return (
    <span className={styles.switches}>
      {sw.sizes.length > 1 && (
        <span className={styles.seg} role="group" aria-label="Team size">
          {sw.sizes.map((s) => (
            <button key={s.size} type="button" aria-pressed={s.pressed} onClick={() => { pick(pickSize(modes, mode, s.size)); }}>{s.size}v{s.size}</button>
          ))}
        </span>
      )}
      <span className={styles.seg} role="group" aria-label="Online or private">
        {sw.kinds.map((k) => (
          <button key={k.kind} type="button" aria-pressed={k.pressed} aria-disabled={!k.enabled} onClick={() => { if (k.enabled) pick(pickKind(modes, mode, k.kind)); }}>
            {k.kind === "online" ? "Online" : "Private"}
          </button>
        ))}
      </span>
    </span>
  );
}

function Carry({ carry, mode, friends, copy }: { carry: WithSide["modes"][number]["carry"]; mode: Mode; friends: readonly Who[]; copy: SideCopy }) {
  const rows = ([["Score", carry.score], ["Goals", carry.goals], ["Assists", carry.assists], ["Saves", carry.saves], ["MVPs", carry.mvps]] as const).map(([label, s]) => [label, carryShares(s, mode)] as const);
  const rest = carryRest(mode, friends.length);
  // The grey end is named (key and bar labels) whenever a bar draws it, even one the mode says can't happen.
  const restKey = rest ?? (rows.some(([, s]) => (s?.pcts[friends.length + 1] ?? 0) > 0) ? OTHERS : null);
  if (carry.matches === 0) return <div className="panel"><p className="muted">Every {MODE_LABEL[mode]} match {copy.together} had a team switch, so there's no share to show.</p></div>;
  return (
    <div className="panel">
      <ul className={styles.legend} aria-label="Bar colours">
        <li><i className={cx(styles.key, styles.me)} />You</li>
        {friends.map((f, i) => <li key={f.id}><i className={cx(styles.key, SHADES[i])} /><Cap name={f.name} /></li>)}
        {restKey !== null && <li><i className={cx(styles.key, styles.rest)} />{restKey}</li>}
      </ul>
      <div className={styles.carry}>
        {rows.map(([label, shares]) => <Bar key={label} label={label} shares={shares} friends={friends} rest={restKey} />)}
      </div>
      <p className={styles.note}>
        Your share of the team's total over {plural(carry.matches, `${MODE_LABEL[mode]} match`, `${MODE_LABEL[mode]} matches`)} {copy.together}. The tick is an even share ({String(Math.round(100 / Number(sizeOf(mode))))}%). Matches where {copy.anyOfYou} of you switched teams are left out.
      </p>
    </div>
  );
}

function Bar({ label, shares, friends, rest }: { label: string; shares: ReturnType<typeof carryShares>; friends: readonly Who[]; rest: string | null }) {
  if (shares === null) return <><span className="muted">{label}</span><span className="muted">none yet</span></>;
  // [you, ...friends, rest]
  const [me = 0, ...after] = shares.pcts;
  const restPct = after[friends.length] ?? 0;
  const parts = friends.map((f, i) => `${f.name} ${String(after[i] ?? 0)}%`);
  if (rest !== null) parts.push(`${rest} ${String(restPct)}%`);
  return (
    <>
      <span className="muted">{label}</span>
      <div className={styles.bar} role="img" aria-label={`${label}: you ${String(me)}%, ${parts.join(", ")}`}>
        <div className={styles.split}>
          <span className={styles.me} style={{ width: `${String(me)}%` }}>{me >= 12 && `You ${String(me)}%`}</span>
          {friends.map((f, i) => {
            const p = after[i] ?? 0;
            return <span key={f.id} className={SHADES[i]} style={{ width: `${String(p)}%` }}>{p >= 8 && `${String(p)}%`}</span>;
          })}
          <span className={styles.rest}>{restPct >= 12 && `${String(restPct)}%`}</span>
        </div>
        <i className={styles.tick} style={{ left: `calc(${String(shares.even)}% - 1px)` }} />
      </div>
    </>
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
    const { text, dir } = diffText(a - b, points);
    return <td className={dir > 0 ? "up" : dir < 0 ? "down" : "muted"}>{text}</td>;
  };
  const winOf = (p: number | null | undefined) => (p === null || p === undefined ? undefined : pct(p));
  const ww = winOf(w.winPct);
  const wow = winOf(wo?.winPct);
  const sep = (i: number) => (i === 0 ? styles.sep : undefined);
  return (
    <div className="panel">
      {/* Focusable, so a keyboard can scroll the table sideways on a narrow screen. */}
      <div className={styles.tw} role="region" aria-label="Who carries, per match" tabIndex={0}>
        <table className="table num">
          <thead>
            <tr>
              <th scope="col">Per match</th>
              <th scope="col">{copy.withColumn}</th>
              <th scope="col">Without</th>
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
              {friends.map((f, i) => <td key={f.id} className={cx(sep(i), "muted")}>–</td>)}
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
        <Tile label="Current streak" value={streakText(side.streak)} note={copy.againstNote} />
        <Tile label="MVPs" value={side.mvps.join("–")} note={copy.versus} noteLines={2} />
        <Tile label="Goals" value={side.goals.join("–")} note={copy.versus} noteLines={2} />
        {side.biggestWin && <Tile label="Biggest win" value={`+${String(side.biggestWin.goalDiff)}`} note={`${day(side.biggestWin.startedAt)} · ${side.biggestWin.label}`} />}
        {overtimeTile(side.overtime)}
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
          <button type="button" className={styles.button} aria-disabled={page === 0} onClick={() => { go(page - 1); }}>← Newer</button>
          <span className="muted" aria-live="polite">{whole(first)}–{whole(first + rows.length - 1)} of {whole(matches.length)}</span>
          <button type="button" className={styles.button} aria-disabled={page === pages - 1} onClick={() => { go(page + 1); }}>Older →</button>
        </div>
      )}
      <p className={styles.note}>★ MVP. Newest first, 10 a page; a date opens the match.</p>
    </div>
  );
}
