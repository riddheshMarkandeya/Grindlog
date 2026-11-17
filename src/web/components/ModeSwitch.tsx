// The mode picker for per-mode stats (Friends' and the Recap's Contribution): a team size group when
// more than one size was played, and Online/Private, a kind disabled where not played at that size.
import { modeSwitch, pickKind, pickSize, type Mode } from "../logic/friends";
import styles from "./ModeSwitch.module.css";

export function ModeSwitch({ modes, mode, pick }: { modes: readonly Mode[]; mode: Mode; pick: (m: Mode) => void }) {
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
