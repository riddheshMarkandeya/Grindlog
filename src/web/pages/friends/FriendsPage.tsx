// The Friends landing: the Suggested panel (a row per suggestion with Add friend · Never suggest,
// the top few shown, the rest behind "Show N more"), a card per friend with both records, a card
// per pair of friends seen together often enough, and the players you said never to suggest.
// Friends come only from suggestions; pairs come from the server. After Add or Never suggest, focus
// goes to the next suggestion's Add (after the last, the one before), else the h1; after Suggest
// again, to the list's summary, else the h1.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { dayOf } from "../../../shared/periods";
import { platformOf } from "../../../shared/platforms";
import type { FriendCard, FriendPair, FriendSuggestions } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { Section } from "../../components/Section";
import { WlBar } from "../../components/WlBar";
import { dateLabel, plural } from "../../logic/format";
import { recordLabel, recordText } from "../../logic/friends";
import { useAddFriend, useFriendPairs, useFriends, useNeverSuggest, useNeverSuggested, useSuggestAgain, useSuggestions } from "../../queries";
import styles from "./Friends.module.css";
import { pairPath } from "./PairPage";
import { focusTo, warnFailed } from "./parts";

export const friendPath = (id: string) => `/friends/${encodeURIComponent(id)}`;

const RULE = "Anyone on your team in 3 or more matches over 2 or more sessions is suggested here.";
const PAIR_RULE = "Two friends both on your team, or both on the other team, in 3 or more matches over 2 or more sessions.";
// Suggestions shown before "Show N more".
const SHOWN = 3;
const lastPlayed = (at: number | null) => `Last played ${at === null ? "–" : dateLabel(dayOf(at))}`;

type Suggestion = FriendSuggestions["suggestions"][number];

type Pending = "suggestions" | "never" | null;

export function FriendsPage() {
  const friends = useFriends();
  const pairs = useFriendPairs();
  const suggestions = useSuggestions();
  const never = useNeverSuggested();
  const add = useAddFriend();
  const neverSuggest = useNeverSuggest();
  const again = useSuggestAgain();
  const location = useLocation();
  const navigate = useNavigate();
  const removed = (location.state as { removed?: string } | null)?.removed;
  const [status, setStatus] = useState(removed ? `Removed ${removed}` : "");
  // Said once: a reload or Back here shouldn't say it again.
  useEffect(() => {
    if (removed !== undefined) void navigate(location.pathname, { replace: true, state: null });
  }, [removed, location.pathname, navigate]);
  const [failed, setFailed] = useState<string | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLElement>(null);
  const pending = useRef<Pending>(null);
  // The suggestion acted on: the one after it now sits at the same place. None left: the h1.
  const actedAt = useRef(0);

  // Focus that falls to the page (a card or link used to get here unmounted) goes to the h1.
  const ready = friends.data !== undefined && suggestions.data !== undefined;
  useEffect(() => {
    if (ready && document.activeElement === document.body) focusTo(h1.current, "h1", "landing");
  }, [ready]);

  useEffect(() => {
    if (pending.current !== "suggestions") return;
    pending.current = null;
    const adds = page.current?.querySelectorAll<HTMLButtonElement>("[data-add]") ?? [];
    const next = adds[Math.min(actedAt.current, adds.length - 1)];
    focusTo(next ?? h1.current, next ? "next_add" : "h1", "landing");
  }, [suggestions.data]);
  useEffect(() => {
    if (pending.current !== "never") return;
    pending.current = null;
    focusTo(summary.current ?? h1.current, summary.current ? "never_summary" : "h1", "landing");
  }, [never.data]);

  // A failed refetch keeps what is shown; only a failed first load shows the error.
  if ((friends.isError && !friends.data) || (suggestions.isError && !suggestions.data)) {
    return (
      <>
        <h1 className="visually-hidden">Friends</h1>
        <EmptyState title="Couldn't load your friends. Is the tracker running?">
          <button type="button" className={styles.link} onClick={() => { void friends.refetch(); void suggestions.refetch(); }}>Retry</button>
        </EmptyState>
      </>
    );
  }
  if (!friends.data || !suggestions.data) {
    return (
      <>
        <h1 className="visually-hidden">Friends</h1>
        <Loading label="Loading your friends…" />
      </>
    );
  }

  const write = (m: typeof add, verb: string, s: { id: string; name: string }) => {
    setFailed(null);
    m.mutate({ id: s.id }, {
      onSuccess: () => {
        pending.current = "suggestions";
        actedAt.current = suggestions.data.findIndex((x) => x.id === s.id);
        setStatus(verb === "add" ? `Added ${s.name}` : `${s.name} won't be suggested again`);
      },
      onError: (e) => {
        warnFailed(verb, e);
        setFailed(`Couldn't ${verb === "add" ? "add" : "hide"} ${s.name}.`);
      },
    });
  };
  const suggestAgain = (p: { id: string; name: string }) => {
    setFailed(null);
    again.mutate({ id: p.id }, {
      onSuccess: () => {
        pending.current = "never";
        setStatus(`${p.name} can be suggested again`);
      },
      onError: (e) => {
        warnFailed("suggest_again", e);
        setFailed(`Couldn't put ${p.name} back.`);
      },
    });
  };
  const busy = add.isPending || neverSuggest.isPending;
  const nothing = friends.data.length === 0 && suggestions.data.length === 0;
  const pairCards = pairs.data ?? [];
  const row = (s: Suggestion) => (
    <SuggestionRow key={s.id} s={s} busy={busy} onAdd={() => { write(add, "add", s); }} onNever={() => { write(neverSuggest, "never", s); }} />
  );

  return (
    <div ref={page}>
      <h1 ref={h1} tabIndex={-1} className="visually-hidden">Friends</h1>
      <p className={styles.status} role="status">{status}</p>
      {failed && <p className={styles.error} role="alert">{failed}</p>}
      {suggestions.data.length > 0 && (
        <Section title="Suggested" intro="Often on your team, not friends yet. Add them to see your record together.">
          <ul className={styles.sugg}>{suggestions.data.slice(0, SHOWN).map(row)}</ul>
          {suggestions.data.length > SHOWN && (
            <details className={styles.more}>
              <summary>Show {suggestions.data.length - SHOWN} more</summary>
              <ul className={styles.sugg}>{suggestions.data.slice(SHOWN).map(row)}</ul>
            </details>
          )}
        </Section>
      )}
      {nothing ? (
        <EmptyState title="No friends yet.">{RULE}</EmptyState>
      ) : (
        <Section title="Your friends">
          {friends.data.length === 0 ? (
            <p className="muted">No friends yet. {RULE}</p>
          ) : (
            <ul className={styles.cards}>
              {friends.data.map((f) => <li key={f.id}><Card f={f} /></li>)}
            </ul>
          )}
        </Section>
      )}
      {pairCards.length > 0 && (
        <Section title="Pairs" intro={PAIR_RULE}>
          <ul className={styles.cards}>
            {pairCards.map(({ pair, a, b }) => <li key={pair.ids.join(",")}><PairCard pair={pair} a={a} b={b} /></li>)}
          </ul>
        </Section>
      )}
      {never.isError && !never.data && (
        <p className={cx(styles.error, styles.never)}>
          Couldn't load the players you said never to suggest. <button type="button" className={styles.link} onClick={() => { void never.refetch(); }}>Retry</button>
        </p>
      )}
      {never.data && never.data.length > 0 && (
        <details className={styles.never}>
          <summary ref={summary}>Players you said never to suggest</summary>
          <ul>
            {never.data.map((p) => (
              <li key={p.id}>
                <span className={styles.trunc} title={p.name}>{p.name} <span className="muted">· {platformOf(p.id).name}</span></span>
                <button type="button" className={styles.button} aria-disabled={again.isPending} onClick={() => { if (!again.isPending) suggestAgain(p); }}>Suggest again</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SuggestionRow({ s, busy, onAdd, onNever }: { s: Suggestion; busy: boolean; onAdd: () => void; onNever: () => void }) {
  return (
    <li>
      <b className={styles.trunc} title={s.name}>{s.name}</b>
      <span className={cx("muted", "num")}>{plural(s.matches, "match", "matches")} · {plural(s.sessions, "session")}</span>
      <span className={styles.acts}>
        <button type="button" data-add className={cx(styles.button, styles.primary)} aria-disabled={busy} onClick={() => { if (!busy) onAdd(); }}>Add friend</button>
        <button type="button" className={styles.button} aria-disabled={busy} onClick={() => { if (!busy) onNever(); }}>Never suggest</button>
      </span>
    </li>
  );
}

/** Together and Against side by side; no match yet is a dash, read as "none yet". */
function Records({ w, a }: { w: FriendCard["with"]; a: FriendCard["with"] }) {
  const side = (label: string, r: FriendCard["with"]) => (
    <div>
      <div className={styles.rk}>{label}</div>
      <div className={cx(styles.rv, "num", "display")}><span aria-hidden="true">{r.n > 0 ? recordText(r) : "–"}</span><span className="visually-hidden">{r.n > 0 ? recordLabel(r) : "none yet"}</span></div>
      {/* Read once, as the hidden "none yet" above. */}
      {r.n > 0 ? <WlBar w={r.w} l={r.l} /> : <div className={cx("muted", styles.small)} aria-hidden="true">not yet</div>}
    </div>
  );
  return (
    <div className={styles.recs}>
      {side("Together", w)}
      {side("Against", a)}
    </div>
  );
}

function Card({ f }: { f: FriendCard }) {
  const seen = f.nickname !== null && f.lastSeenName !== null ? `${f.lastSeenName} · ` : "";
  return (
    <Link to={friendPath(f.id)} className={styles.card}>
      <span className={cx(styles.name, styles.trunc)} title={f.name}>{f.name}</span>
      <span className={cx("muted", styles.small, styles.trunc)} title={seen + platformOf(f.id).name}>{seen}{platformOf(f.id).name}</span>
      <Records w={f.with} a={f.against} />
      <span className={cx("muted", styles.small)}>{lastPlayed(f.lastPlayed)}</span>
    </Link>
  );
}

function PairCard({ pair, a, b }: { pair: FriendPair; a: string; b: string }) {
  return (
    <Link to={pairPath(...pair.ids)} className={styles.card}>
      <span className={cx(styles.name, styles.trunc)} title={a}>{a}</span>
      <span className={cx(styles.second, styles.trunc)} title={b}><i>+</i> {b}</span>
      <Records w={pair.with} a={pair.against} />
      <span className={cx("muted", styles.small)}>{lastPlayed(pair.lastPlayed)}</span>
    </Link>
  );
}
