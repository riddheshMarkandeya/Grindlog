// Two friends together: their names, then the scorebug and the two zones every friend page shares,
// counting only matches where both were on your team, or both on the other. Reached from a Together
// card on the landing; the URL names the two ids in key order.
import { type RefObject, useEffect, useRef } from "react";
import { Link, useParams } from "react-router";
import { pairKey } from "../../../shared/teammate-filter";
import { ApiError } from "../../api";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { usePairDetail } from "../../queries";
import styles from "./Friends.module.css";
import { focusTo } from "./parts";
import { BackLink, Bug, Zones } from "./zones";

export const pairPath = (a: string, b: string) => `/friends/${pairKey(a, b).map(encodeURIComponent).join("/")}`;

export function PairPage() {
  const { a = "", b = "" } = useParams();
  // Keyed by the pair, so the modes and pages start over for each.
  return <Pair key={pairPath(a, b)} a={a} b={b} />;
}

function Pair({ a, b }: { a: string; b: string }) {
  const detail = usePairDetail(a, b);
  const h1 = useRef<HTMLHeadingElement>(null);
  const loaded = detail.data !== undefined;
  useEffect(() => {
    if (loaded && document.activeElement === document.body) focusTo(h1.current, "h1", "pair");
  }, [loaded]);

  return (
    <>
      <BackLink />
      <Body detail={detail} h1={h1} />
    </>
  );
}

function Body({ detail, h1 }: { detail: ReturnType<typeof usePairDetail>; h1: RefObject<HTMLHeadingElement | null> }) {
  if (detail.isError && !detail.data) {
    const gone = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <>
        <h1 ref={h1} tabIndex={-1} className={styles.h1}>{gone ? "Not both friends" : "Together"}</h1>
        <EmptyState title={gone ? "These two aren't both your friends." : "Couldn't load these two. Is the tracker running?"}>
          {gone ? <Link to="/friends">See your friends</Link> : <button type="button" className={styles.link} onClick={() => { void detail.refetch(); }}>Retry</button>}
        </EmptyState>
      </>
    );
  }
  if (!detail.data) return <Loading label="Loading your friends…" />;
  const { friends, view } = detail.data;
  const [x, y] = friends;
  return (
    <>
      <h1 ref={h1} tabIndex={-1} className={cx(styles.h1, styles.pairH1)}>{x.name} <span className={styles.muted}>+</span> {y.name}</h1>
      <Bug friends={friends} view={view} />
      <Zones friends={friends} view={view} />
    </>
  );
}
