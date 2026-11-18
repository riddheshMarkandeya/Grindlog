// The mode picker for per-mode stats (Friends' and the Recap's Contribution): a team size group when
// more than one size was played, and Online/Private, a kind disabled where not played at that size.
import { modeSwitch, pickKind, pickSize, type Mode } from "../logic/friends";
import { type ReactNode, useRef } from "react";
import { cx } from "./cx";
import styles from "./ModeSwitch.module.css";
import { useIndicator } from "./useIndicator";

export function ModeSwitch({ modes, mode, pick }: { modes: readonly Mode[]; mode: Mode; pick: (m: Mode) => void }) {
  const sw = modeSwitch(modes, mode);
  return (
    <span className={styles.switches}>
      {sw.sizes.length > 1 && (
        <Seg label="Team size" pressed={mode}>
          {sw.sizes.map((s) => (
            <button key={s.size} type="button" aria-pressed={s.pressed} onClick={() => { pick(pickSize(modes, mode, s.size)); }}>{s.size}v{s.size}</button>
          ))}
        </Seg>
      )}
      <Seg label="Online or private" pressed={mode}>
        {sw.kinds.map((k) => (
          <button key={k.kind} type="button" aria-pressed={k.pressed} aria-disabled={!k.enabled} onClick={() => { if (k.enabled) pick(pickKind(modes, mode, k.kind)); }}>
            {k.kind === "online" ? "Online" : "Private"}
          </button>
        ))}
      </Seg>
    </span>
  );
}

/** One segmented group; the pressed button is marked by one sliding pill. */
function Seg({ label, pressed, children }: { label: string; pressed: unknown; children: ReactNode }) {
  const group = useRef<HTMLSpanElement>(null);
  useIndicator(group, '[aria-pressed="true"]', "x", pressed);
  return <span ref={group} className={cx(styles.seg, "ind-x")} role="group" aria-label={label}>{children}</span>;
}
