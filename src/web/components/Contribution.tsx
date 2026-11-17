// The Contribution panel (Friends' "stats with them", the Recap session): your share of your team's
// total per row, each listed friend in their own colour and the rest of your team in grey, with a
// tick at an even share. % inside the bars; hovering a segment gives its count of the team's total.
import { sum } from "../../shared/aggregate";
import type { Carry } from "../../shared/contribution";
import { pctText, plural, wholeShares } from "../logic/format";
import { carryRest, evenShare, MODE_LABEL, shareTitle, type Mode } from "../logic/friends";
import { BarPct } from "./BarPct";
import styles from "./Bars.module.css";
import { cx } from "./cx";

export interface Who { id: string; name: string }

// Friend i's colour in the bars and the legend; a teammate filter lists two friends at most.
const SHADES = [styles.friendA, styles.friendB];

/**
 * `scope` ends the note's count ("together", "this session"). Shares are over matches with no team
 * switch by you or a listed friend; touches over the ones recomputed too.
 */
export function Contribution({ carry, mode, friends, scope }: { carry: Carry; mode: Mode; friends: readonly Who[]; scope: string }) {
  const label = MODE_LABEL[mode];
  const anyOfYou = friends.length === 0 ? "you" : friends.length === 1 ? "either of you" : "any of you";
  if (carry.matches === 0) return <div className="panel"><p className="muted">Every {label} match {scope} had a team switch, so there's no share to show.</p></div>;
  const rows = ([["Score", carry.score], ["Goals", carry.goals], ["Assists", carry.assists], ["Saves", carry.saves], ["Shots", carry.shots], ["Touches", carry.touches], ["MVPs", carry.mvps]] as const)
    .map(([name, raw]) => ({ name, raw, pcts: wholeShares(raw) }));
  // The grey end is named (key and bar labels) whenever a bar draws it, even one the mode says can't happen.
  const rest = carryRest(mode, friends.length, rows.some((r) => (r.pcts?.[friends.length + 1] ?? 0) > 0));
  // [you, ...friends, rest]: each segment's name and colour, in the order the counts come.
  const who: Segment[] = [
    { key: "you", name: "You", cls: styles.me, isMe: true },
    ...friends.map((f, i) => ({ key: f.id, name: f.name, cls: SHADES[i], isMe: false })),
    { key: "rest", name: rest, cls: styles.rest, isMe: false },
  ];
  const even = evenShare(mode);
  const partly = carry.touchMatches > 0 && carry.touchMatches < carry.matches;
  return (
    <div className="panel">
      <ul className={styles.legend} aria-label="Bar colours">
        <li><i className={cx(styles.key, styles.me)} />You</li>
        {friends.map((f, i) => <li key={f.id}><i className={cx(styles.key, SHADES[i])} /><span title={f.name}>{f.name}</span></li>)}
        {rest !== null && <li><i className={cx(styles.key, styles.rest)} />{rest}</li>}
      </ul>
      <div className={styles.grid}>
        {rows.map((r) => (
          <Bar key={r.name} name={r.name} raw={r.raw} pcts={r.pcts} who={who} even={even} none={r.name === "Touches" && carry.touchMatches === 0 ? "no touch data yet" : "none"} />
        ))}
      </div>
      <p className={styles.note}>
        Your share of the team's total over {plural(carry.matches, `${label} match`, `${label} matches`)} {scope}.
        {partly && ` Touches over ${String(carry.touchMatches)} of them.`} The tick is an even share ({pctText(Math.round(even))}). Matches where {anyOfYou} switched teams are left out. Hover a bar for the numbers.
      </p>
    </div>
  );
}

interface Segment { key: string; name: string | null; cls: string | undefined; isMe: boolean }

/** One row's bar; `none` is said instead when the team has none of it. An unnamed rest is drawn but not spoken. */
function Bar({ name, raw, pcts, who, even, none }: { name: string; raw: readonly number[]; pcts: number[] | null; who: readonly Segment[]; even: number; none: string }) {
  if (pcts === null) return <><span className={styles.who}>{name}</span><span className="muted">{none}</span></>;
  const total = sum(raw);
  const segs = who.map((w, i) => ({ ...w, p: pcts[i] ?? 0, n: raw[i] ?? 0 }));
  const spoken = segs.flatMap((s) => (s.name === null ? [] : [`${s.isMe ? "you" : s.name} ${pctText(s.p)}`]));
  return (
    <>
      <span className={styles.who}>{name}</span>
      <div className={styles.bar} role="img" aria-label={`${name}: ${spoken.join(", ")}`}>
        <div className={styles.split}>
          {segs.map((s) => (
            <span key={s.key} className={s.cls} style={{ width: `${String(s.p)}%` }} title={s.name === null ? undefined : shareTitle(s.name, s.n, total, s.p)}>
              <BarPct p={s.p} you={s.isMe} />
            </span>
          ))}
        </div>
        <i className={styles.tick} style={{ left: `calc(${String(even)}% - 1px)` }} />
      </div>
    </>
  );
}
