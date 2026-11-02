// The Friends landing: a banner per suggestion (Add friend · Never suggest), a pair card per friend
// with both records, and the players you said never to suggest. Friends come only from suggestions.
// After Add or Never suggest, focus goes to the next banner's Add (after the last, the one before),
// else the h1; after Suggest again, to the list's summary, else the h1.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { dayOf } from "../../../shared/periods";
import { platformOf } from "../../../shared/platforms";
import type { FriendCard } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { dateLabel, plural } from "../../logic/format";
import { recordText } from "../../logic/friends";
import { useAddFriend, useFriends, useNeverSuggest, useNeverSuggested, useSuggestAgain, useSuggestions } from "../../queries";
import styles from "./Friends.module.css";
import { focusTo, recordLabel, warnFailed, WlBar } from "./parts";

export const friendPath = (id: string) => `/friends/${encodeURIComponent(id)}`;

const RULE = "Anyone on your team in 3 or more matches over 2 or more sessions is suggested here.";

type Pending = "suggestions" | "never" | null;

export function FriendsPage() {
  const friends = useFriends();
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
  // The banner acted on: the one after it now sits at the same place. None left: the h1.
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
        <h1 className={styles.h1}>Friends</h1>
        <EmptyState title="Couldn't load your friends. Is the tracker running?">
          <button type="button" className={styles.link} onClick={() => { void friends.refetch(); void suggestions.refetch(); }}>Retry</button>
        </EmptyState>
      </>
    );
  }
  if (!friends.data || !suggestions.data) {
    return (
      <>
        <h1 className={styles.h1}>Friends</h1>
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

  return (
    <div ref={page}>
      <h1 ref={h1} tabIndex={-1} className={styles.h1}>Friends</h1>
      <p className={styles.status} role="status">{status}</p>
      {failed && <p className={styles.error} role="alert">{failed}</p>}
      {suggestions.data.map((s) => (
        <div key={s.id} className={styles.banner}>
          <p>
            You've teamed up with <b title={s.name}>{s.name}</b> in {plural(s.matches, "match", "matches")} over {plural(s.sessions, "session")}. Add them as a friend?
          </p>
          <span className={styles.acts}>
            <button type="button" data-add className={cx(styles.button, styles.primary)} aria-disabled={busy} onClick={() => { if (!busy) write(add, "add", s); }}>Add friend</button>
            <button type="button" className={styles.button} aria-disabled={busy} onClick={() => { if (!busy) write(neverSuggest, "never", s); }}>Never suggest</button>
          </span>
        </div>
      ))}
      {nothing ? (
        <EmptyState title="No friends yet.">{RULE}</EmptyState>
      ) : friends.data.length === 0 ? (
        <p className={styles.muted}>No friends yet. {RULE}</p>
      ) : (
        <ul className={styles.cards}>
          {friends.data.map((f) => <li key={f.id}><Card f={f} /></li>)}
        </ul>
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
                <span className={styles.trunc} title={p.name}>{p.name} <span className={styles.muted}>· {platformOf(p.id).name}</span></span>
                <button type="button" className={styles.button} aria-disabled={again.isPending} onClick={() => { if (!again.isPending) suggestAgain(p); }}>Suggest again</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Card({ f }: { f: FriendCard }) {
  const seen = f.nickname !== null && f.lastSeenName !== null ? `${f.lastSeenName} · ` : "";
  const side = (label: string, r: FriendCard["with"]) => (
    <div>
      <div className={styles.rk}>{label}</div>
      <div className={cx(styles.rv, "num")}><span aria-hidden="true">{recordText(r)}</span><span className="visually-hidden">{recordLabel(r)}</span></div>
      {r.n > 0 ? <WlBar w={r.w} l={r.l} /> : <div className={cx(styles.muted, styles.small)}>not yet</div>}
    </div>
  );
  return (
    <Link to={friendPath(f.id)} className={styles.card}>
      <span className={cx(styles.name, styles.trunc)} title={f.name}>{f.name}</span>
      <span className={cx(styles.muted, styles.small, styles.trunc)} title={seen + platformOf(f.id).name}>{seen}{platformOf(f.id).name}</span>
      <div className={styles.recs}>
        {side("Together", f.with)}
        {side("Against", f.against)}
      </div>
      <span className={cx(styles.muted, styles.small)}>Last played {f.lastPlayed === null ? "–" : dateLabel(dayOf(f.lastPlayed))}</span>
    </Link>
  );
}
