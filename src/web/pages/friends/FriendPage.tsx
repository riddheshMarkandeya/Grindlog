// One friend: a header (name, nickname, remove), then the scorebug and the two zones every friend
// page shares. Everything is worked out on the server; the open forms are this view's own state,
// reset per friend.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { platformOf } from "../../../shared/platforms";
import type { FriendDetail } from "../../../shared/schemas/responses";
import { ApiError } from "../../api";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { SaveStatus } from "../../components/SaveStatus";
import { useFriendDetail, useRemoveFriend, useSetNickname } from "../../queries";
import styles from "./Friends.module.css";
import { focusTo, useOpenFocus, warnFailed } from "./parts";
import { BackLink, Bug, Zones } from "./zones";

const NICKNAME_MAX = 32;

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
      <Bug friends={[friend]} view={view} />
      <Zones friends={[friend]} view={view} />
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
