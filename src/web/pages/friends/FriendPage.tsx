// One friend: a header (name, nickname, remove), the recap scorebug with both records, then two
// zones: On your team (tiles, by playlist, who carries and your stats with them per mode) and On
// the other team (tiles, by playlist, match by match). Everything is worked out on the server; the
// mode and the page of matches are this view's own state, reset per friend.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { dayOf } from "../../../shared/periods";
import { platformOf } from "../../../shared/platforms";
import type { FriendDetail } from "../../../shared/schemas/responses";
import { ApiError } from "../../api";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { SaveStatus } from "../../components/SaveStatus";
import { Scorebug } from "../../components/Scorebug";
import { Tile, Tiles } from "../../components/Tile";
import { dateLabel, decimal, durationText, plural } from "../../logic/format";
import { carryShares, modeSwitch, PAGE_SIZE, pageOf, pickKind, pickMode, pickSize, recordText, sizeOf, winPctText, type Mode } from "../../logic/friends";
import { letter, pct, recapPath } from "../../logic/recap";
import { useFriendDetail, useRemoveFriend, useSetNickname } from "../../queries";
import styles from "./Friends.module.css";
import { focusTo, recordLabel, useOpenFocus, warnFailed, WlBar } from "./parts";

type View = FriendDetail["view"];
type WithSide = View["with"];
type AgainstSide = View["against"];
type Row = WithSide["playlists"][number];

const MODE_LABEL: Record<Mode, string> = { "2": "2v2", "3": "3v3", "4": "4v4", p2: "Private 2v2", p3: "Private 3v3" };
const NICKNAME_MAX = 32;
const day = (ms: number) => dateLabel(dayOf(ms));
const streakText = (s: WithSide["streak"]) => (s === null ? "–" : `${String(s.length)} ${letter(s.result)}`);

export function FriendPage() {
  const { id = "" } = useParams();
  // Keyed by id, so the mode, page and open forms start over for each friend.
  return <Friend key={id} id={id} />;
}

function Friend({ id }: { id: string }) {
  const detail = useFriendDetail(id);
  const h1 = useRef<HTMLHeadingElement>(null);
  const loaded = detail.data !== undefined;
  useEffect(() => {
    if (loaded && document.activeElement === document.body) focusTo(h1.current, "h1", "friend");
  }, [loaded]);

  if (detail.isError && !detail.data) {
    const gone = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <>
        <BackLink />
        <h1 ref={h1} tabIndex={-1} className={styles.h1}>{gone ? "Not a friend" : "Friend"}</h1>
        <EmptyState title={gone ? "This player isn't one of your friends." : "Couldn't load this friend. Is the tracker running?"}>
          {gone ? <Link to="/friends">See your friends</Link> : <button type="button" className={styles.link} onClick={() => { void detail.refetch(); }}>Retry</button>}
        </EmptyState>
      </>
    );
  }
  if (!detail.data) {
    return (
      <>
        <BackLink />
        <Loading label="Loading your friend…" />
      </>
    );
  }
  const { friend, view } = detail.data;
  return (
    <>
      <BackLink />
      <Head friend={friend} h1={h1} />
      <Bug name={friend.name} view={view} />
      <div className={styles.zones}>
        <section className={cx(styles.zone, styles.with)} aria-labelledby="with-heading">
          <h2 id="with-heading" className={styles.zh}>On your team</h2>
          {view.with.record.n === 0 ? <p className={styles.muted}>You haven't teamed up with {friend.name} yet.</p> : <WithZone side={view.with} name={friend.name} />}
          {view.with.record.n > 0 && (
            <div className={styles.links}>
              <Link to={recapPath(null, "everything", "overview", { friends: [friend.id] })}>Matches with {friend.name} →</Link>
              <Link to={`/trends?with=${encodeURIComponent(friend.id)}`}>Trends with {friend.name} →</Link>
            </div>
          )}
        </section>
        <section className={cx(styles.zone, styles.against)} aria-labelledby="against-heading">
          <h2 id="against-heading" className={styles.zh}>On the other team</h2>
          {view.against.record.n === 0 ? <p className={styles.muted}>You haven't played against {friend.name} yet.</p> : <AgainstZone side={view.against} name={friend.name} />}
        </section>
      </div>
    </>
  );
}

const BackLink = () => <Link to="/friends" className={styles.back}>← Friends</Link>;

function Bug({ name, view }: { name: string; view: View }) {
  const w = view.with.record;
  const a = view.against.record;
  return (
    <>
      <Scorebug
        records
        label={`Together ${recordLabel(w)}; head-to-head ${recordLabel(a)}`}
        left={{ label: "TOGETHER", value: recordText(w) }}
        right={{ label: "HEAD-TO-HEAD", value: recordText(a) }}
        mid={
          <>
            <span className={styles.mid} title={name}>{name.toUpperCase()}</span>
            <b className="num">{winPctText(w)} · {winPctText(a)}</b>
            <span>WITH · AGAINST</span>
          </>
        }
      />
      <p className={styles.lastLine}>
        Last together {view.with.last === null ? "–" : day(view.with.last)} · last against {view.against.last === null ? "–" : day(view.against.last)}
      </p>
      <p className={styles.private}>Private matches count here; Recap and Trends leave them out unless filtered to Private.</p>
    </>
  );
}

function Head({ friend, h1 }: { friend: FriendDetail["friend"]; h1: RefObject<HTMLHeadingElement | null> }) {
  const platform = platformOf(friend.id).name;
  return (
    <div className={styles.fhead}>
      <div className={styles.who}>
        <h1 ref={h1} tabIndex={-1} className={styles.h1} title={friend.name}>{friend.name}</h1>
        {friend.nickname !== null && friend.lastSeenName !== null && (
          <span className={cx(styles.muted, styles.trunc, styles.seen)} title={friend.lastSeenName}>seen as {friend.lastSeenName}</span>
        )}
        <span className={styles.muted}>{platform}</span>
        <Nickname friend={friend} />
      </div>
      <Remove friend={friend} />
    </div>
  );
}

function Nickname({ friend }: { friend: FriendDetail["friend"] }) {
  const save = useSetNickname();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(friend.nickname ?? "");
  const input = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  useOpenFocus(editing, input, edit, "nickname");

  const submit = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (save.isPending) return;
    const nickname = value.trim() || null;
    save.mutate({ id: friend.id, nickname }, {
      onSuccess: () => { setEditing(false); },
      onError: (err) => { warnFailed("nickname", err); },
    });
  };
  const cancel = () => {
    save.reset();
    setEditing(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <form className={styles.form} onSubmit={submit} onKeyDown={onKey}>
        <input
          ref={input}
          className={styles.input}
          aria-label="Nickname"
          value={value}
          maxLength={NICKNAME_MAX}
          placeholder={friend.lastSeenName ?? friend.id}
          onChange={(e) => { setValue(e.target.value); }}
        />
        <button type="submit" className={cx(styles.button, styles.primary)} aria-disabled={save.isPending}>Save</button>
        <button type="button" className={styles.button} onClick={cancel}>Cancel</button>
        <span className={styles.muted}>Empty uses the name they last played as.</span>
        <SaveStatus m={save} retry={() => { submit(); }} />
      </form>
    );
  }
  return (
    <>
      <button ref={edit} type="button" className={styles.link} onClick={() => { setValue(friend.nickname ?? ""); setEditing(true); }}>
        {friend.nickname === null ? "Set nickname" : "Edit nickname"}
      </button>
      <SaveStatus m={save} />
    </>
  );
}

function Remove({ friend }: { friend: FriendDetail["friend"] }) {
  const remove = useRemoveFriend();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useOpenFocus(asking, yes, trigger, "remove");

  const confirm = () => {
    if (remove.isPending) return;
    remove.mutate({ id: friend.id }, {
      onSuccess: () => { void navigate("/friends", { replace: true, state: { removed: friend.name } }); },
      onError: (e) => {
        warnFailed("remove", e);
        yes.current?.focus();
      },
    });
  };

  if (!asking) return <button ref={trigger} type="button" className={styles.button} onClick={() => { setAsking(true); }}>Remove friend</button>;
  return (
    <div className={styles.confirm} role="group" aria-label={`Remove ${friend.name}?`} onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }}>
      <span>Remove {friend.name}? Your matches stay; they leave the filter and this page.</span>
      <button ref={yes} type="button" className={styles.button} aria-disabled={remove.isPending} onClick={confirm}>Remove</button>
      <button type="button" className={styles.button} onClick={() => { remove.reset(); setAsking(false); }}>Keep</button>
      {remove.isError && <span className={styles.error} role="alert">Couldn't remove {friend.name}. Try again.</span>}
    </div>
  );
}

function Playlists({ rows }: { rows: readonly Row[] }) {
  return (
    <div className={styles.panel}>
      {rows.map((r) => (
        <div key={r.label} className={styles.pl}>
          <span className={styles.trunc} title={r.label}>{r.label}</span>
          <span className={cx(styles.r, "num")}><span aria-hidden="true">{recordText(r)}</span><span className="visually-hidden">{recordLabel(r)}</span></span>
          <WlBar w={r.w} l={r.l} />
          <span className={cx(styles.r, styles.muted, "num")}>{winPctText(r)}</span>
        </div>
      ))}
    </div>
  );
}

const playlistNote = (r: Row) => `${r.label} · ${recordText(r)}`;
const overtimeTile = (ot: WithSide["overtime"]) => ot.n > 0 && <Tile label="Overtime" value={recordText(ot)} note={`${winPctText(ot)} of ${String(ot.n)}`} />;

function WithZone({ side, name }: { side: WithSide; name: string }) {
  return (
    <>
      <Tiles>
        <Tile label="Current streak" value={streakText(side.streak)} note="together" />
        <Tile label="Best win streak" value={String(side.bestWinStreak)} note="together" />
        {side.best && <Tile label="Best playlist" value={winPctText(side.best)} note={playlistNote(side.best)} />}
        {side.worst && <Tile label="Worst playlist" value={winPctText(side.worst)} note={playlistNote(side.worst)} />}
        <Tile label="Time together" value={durationText(side.timeMs)} note={`over ${plural(side.record.n, "match", "matches")}`} />
        {overtimeTile(side.overtime)}
      </Tiles>
      <div className={styles.sec}><h3>By playlist</h3></div>
      <Playlists rows={side.playlists} />
      {side.defaultMode !== null && <Modes side={side} defaultMode={side.defaultMode} name={name} />}
    </>
  );
}

function Modes({ side, defaultMode, name }: { side: WithSide; defaultMode: Mode; name: string }) {
  const modes = side.modes.map((m) => m.mode);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode = pickMode(modes, defaultMode, picked);
  const view = side.modes.find((m) => m.mode === mode);
  if (!view) return null;
  const sw = modeSwitch(modes, mode);
  return (
    <>
      <div className={styles.sec}>
        <h3>Who carries · stats with them</h3>
        {modes.length === 1 ? (
          <span className={styles.muted}>{MODE_LABEL[mode]}</span>
        ) : (
          <span className={styles.switches}>
            {sw.sizes.length > 1 && (
              <span className={styles.seg} role="group" aria-label="Team size">
                {sw.sizes.map((s) => (
                  <button key={s.size} type="button" aria-pressed={s.pressed} onClick={() => { setPicked(pickSize(modes, mode, s.size)); }}>{s.size}v{s.size}</button>
                ))}
              </span>
            )}
            <span className={styles.seg} role="group" aria-label="Online or private">
              {sw.kinds.map((k) => (
                <button key={k.kind} type="button" aria-pressed={k.pressed} aria-disabled={!k.enabled} onClick={() => { if (k.enabled) setPicked(pickKind(modes, mode, k.kind)); }}>
                  {k.kind === "online" ? "Online" : "Private"}
                </button>
              ))}
            </span>
          </span>
        )}
      </div>
      <Carry carry={view.carry} mode={mode} name={name} />
      <Compare compare={view.compare} mode={mode} name={name} />
    </>
  );
}

function Carry({ carry, mode, name }: { carry: WithSide["modes"][number]["carry"]; mode: Mode; name: string }) {
  const rows = [["Score", carry.score], ["Goals", carry.goals], ["Assists", carry.assists], ["Saves", carry.saves], ["MVPs", carry.mvps]] as const;
  const size = Number(sizeOf(mode));
  const rest = size > 3 ? "the other teammates" : "the third teammate";
  if (carry.matches === 0) return <div className={styles.panel}><p className={styles.muted}>Every {MODE_LABEL[mode]} match together had a team switch, so there's no share to show.</p></div>;
  return (
    <div className={styles.panel}>
      <div className={styles.carry}>
        {rows.map(([label, shares]) => {
          const s = carryShares(shares, mode);
          return <Bar key={label} label={label} shares={s} name={name} />;
        })}
      </div>
      <p className={styles.note}>
        Your share of the team's total over {plural(carry.matches, `${MODE_LABEL[mode]} match`, `${MODE_LABEL[mode]} matches`)} together; light blue is {name}
        {size > 2 ? `, grey ${rest}` : ""}. The tick is an even share ({String(Math.round(100 / size))}%). Matches where either of you switched teams are left out.
      </p>
    </div>
  );
}

function Bar({ label, shares, name }: { label: string; shares: ReturnType<typeof carryShares>; name: string }) {
  if (shares === null) return <><span className={styles.muted}>{label}</span><span className={styles.muted}>none yet</span></>;
  // This page has one friend: [you, them, rest].
  const [me = 0, them = 0, rest = 0] = shares.pcts;
  return (
    <>
      <span className={styles.muted}>{label}</span>
      <div className={styles.bar} role="img" aria-label={`${label}: you ${String(me)}%, ${name} ${String(them)}%, the rest ${String(rest)}%`}>
        <div className={styles.split}>
          <span className={styles.me} style={{ width: `${String(me)}%` }}>{me >= 12 && `You ${String(me)}%`}</span>
          <span className={styles.them} style={{ width: `${String(them)}%` }}>{them >= 8 && `${String(them)}%`}</span>
          <span className={styles.rest}>{rest >= 12 && `${String(rest)}%`}</span>
        </div>
        <i className={styles.tick} style={{ left: `calc(${String(shares.even)}% - 1px)` }} />
      </div>
    </>
  );
}

type CompareView = WithSide["modes"][number]["compare"];
const STATS = [["score", "Score"], ["goals", "Goals"], ["assists", "Assists"], ["saves", "Saves"], ["shots", "Shots"]] as const;

function Compare({ compare, mode, name }: { compare: CompareView; mode: Mode; name: string }) {
  const { with: w, without: wo, friends: [them] } = compare;
  // Win % differs in whole points; the stats in decimal()'s steps.
  const diff = (a: number, b: number | undefined, points = false) => {
    if (b === undefined) return <td className={styles.muted}>–</td>;
    const d = a - b;
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    return <td className={d > 0 ? styles.up : d < 0 ? styles.down : styles.muted}>{sign}{points ? String(Math.abs(d)) : decimal(Math.abs(d))}</td>;
  };
  const winOf = (p: number | null | undefined) => (p === null || p === undefined ? undefined : pct(p));
  const ww = winOf(w.winPct);
  const wow = winOf(wo?.winPct);
  return (
    <div className={styles.panel}>
      <div className={styles.tw}>
        <table className={cx(styles.table, "num")}>
          <thead>
            <tr><th scope="col">Per match</th><th scope="col">With {name}</th><th scope="col">Without</th><th scope="col">Diff</th><th scope="col" className={styles.sep}>{name}</th></tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Win %</th>
              <td>{ww === undefined ? "–" : `${String(ww)}%`}</td>
              <td className={styles.muted}>{wow === undefined ? "–" : `${String(wow)}%`}</td>
              {ww === undefined ? <td className={styles.muted}>–</td> : diff(ww, wow, true)}
              <td className={cx(styles.sep, styles.muted)}>–</td>
            </tr>
            {STATS.map(([k, label]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td>{decimal(w[k])}</td>
                <td className={styles.muted}>{wo ? decimal(wo[k]) : "–"}</td>
                {diff(w[k], wo?.[k])}
                <td className={styles.sep}>{them ? decimal(them[k]) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        Your {MODE_LABEL[mode]} matches with them ({String(w.matches)}) against your other {MODE_LABEL[mode]} matches ({String(wo?.matches ?? 0)}), including ones where they were an opponent.
        {mode.startsWith("p") ? " Uneven private lobbies are left out." : " Private matches are left out of both."} Their column is their scoreboard only.
      </p>
    </div>
  );
}

function AgainstZone({ side, name }: { side: AgainstSide; name: string }) {
  const versus = `you – ${name}`;
  return (
    <>
      <Tiles>
        <Tile label="Current streak" value={streakText(side.streak)} note="against them" />
        <Tile label="MVPs" value={`${String(side.mvps[0])}–${String(side.mvps[1])}`} note={versus} />
        <Tile label="Goals" value={`${String(side.goals[0])}–${String(side.goals[1])}`} note={versus} />
        {side.biggestWin && <Tile label="Biggest win" value={`+${String(side.biggestWin.goalDiff)}`} note={`${day(side.biggestWin.startedAt)} · ${side.biggestWin.label}`} />}
        {overtimeTile(side.overtime)}
      </Tiles>
      <div className={styles.sec}><h3>By playlist</h3></div>
      <Playlists rows={side.playlists} />
      <div className={styles.sec}><h3>Match by match</h3></div>
      <Matches matches={side.matches} name={name} />
    </>
  );
}

const COLS = [["score", "Sc", "Score"], ["goals", "G", "Goals"], ["assists", "A", "Assists"], ["saves", "Sv", "Saves"], ["shots", "Sh", "Shots"]] as const;

function Matches({ matches, name }: { matches: AgainstSide["matches"]; name: string }) {
  const [asked, setAsked] = useState(0);
  const { rows, page, pages } = pageOf(matches, asked);
  const first = page * PAGE_SIZE + 1;
  const go = (to: number) => { if (to >= 0 && to < pages) setAsked(to); };
  return (
    <div className={styles.panel}>
      <div className={styles.tw}>
        <table className={cx(styles.table, "num")}>
          <thead>
            <tr>
              <td />
              <td />
              <th scope="colgroup" colSpan={5} className={styles.you}>You</th>
              <th scope="colgroup" colSpan={5} className={cx(styles.sep, styles.them)} title={name}>{name}</th>
            </tr>
            <tr>
              <th scope="col">Match</th>
              <th scope="col"><span className="visually-hidden">Result</span></th>
              {COLS.map(([k, short, long]) => <th key={`me-${k}`} scope="col"><abbr title={long}>{short}</abbr></th>)}
              {COLS.map(([k, short, long], i) => <th key={`them-${k}`} scope="col" className={i === 0 ? styles.sep : undefined}><abbr title={long}>{short}</abbr></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.guid}>
                <td>
                  {m.sessionKey === null ? day(m.startedAt) : (
                    <Link to={recapPath(m.sessionKey, m.playlistId === null ? "everything" : { playlist: m.playlistId }, { match: m.guid })}>{day(m.startedAt)}</Link>
                  )}{" "}
                  <span className={styles.muted}>{m.label}</span>
                </td>
                <td className={m.result === "win" ? styles.w : m.result === "loss" ? styles.l : styles.muted}>
                  {letter(m.result)}{m.mvp === 0 && <span title="Your MVP"> ★</span>}
                </td>
                {COLS.map(([k]) => <td key={`me-${k}`}>{m.me[k]}</td>)}
                {COLS.map(([k], i) => (
                  <td key={`them-${k}`} className={i === 0 ? styles.sep : undefined}>{m.friends[0]?.[k]}{i === 0 && m.mvp === 1 && <span title={`${name}'s MVP`}> ★</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className={styles.pager}>
          <button type="button" className={styles.button} aria-disabled={page === 0} onClick={() => { go(page - 1); }}>← Newer</button>
          <span className={styles.muted} aria-live="polite">{first}–{first + rows.length - 1} of {matches.length}</span>
          <button type="button" className={styles.button} aria-disabled={page === pages - 1} onClick={() => { go(page + 1); }}>Older →</button>
        </div>
      )}
      <p className={styles.note}>★ MVP. Newest first, 10 a page; a date opens the match.</p>
    </div>
  );
}
