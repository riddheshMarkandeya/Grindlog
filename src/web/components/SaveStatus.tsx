// A write's outcome next to what it changed: "✓ Saved" (fading), or "Couldn't save · Retry".
import styles from "./SaveStatus.module.css";

/** What a status shows: a mutation, or a table row's own state. `submittedAt` restarts the tick's fade. */
export interface SaveState {
  isSuccess: boolean;
  isError: boolean;
  submittedAt: number;
}

/** The live region is there from the start, so each outcome is announced. */
export function SaveStatus({ m, retry }: { m: SaveState; retry?: () => void }) {
  return (
    <span className={styles.status} role="status">
      {m.isSuccess && <span key={m.submittedAt} className={styles.tick}>✓ Saved</span>}
      {m.isError && retry && (
        <span className={styles.failed}>
          Couldn't save · <button type="button" className={styles.link} onClick={retry}>Retry</button>
        </span>
      )}
    </span>
  );
}
