// "Is this you?" at the top of the recap while a guessed player is unanswered, so a new alt gets
// asked too. Small and dismissible: a dismissal is remembered per player in this browser.
import { useEffect, useRef, useState } from "react";
import type { IdAnswer } from "../../../shared/schemas/tables";
import { ApiError } from "../../api";
import { cx } from "../../components/cx";
import { SaveStatus } from "../../components/SaveStatus";
import { ANSWER_TEXT, loadDismissed, pickGuess, saveDismissed } from "../../logic/guess";
import { useIds, useSetIdStatus } from "../../queries";
import styles from "./GuessCard.module.css";

export function GuessCard() {
  const ids = useIds();
  const m = useSetIdStatus();
  const [dismissed, setDismissed] = useState(loadDismissed);
  const guess = pickGuess(ids.data, dismissed);
  const box = useRef<HTMLElement>(null);
  /** Set by an answer or a dismissal, so the next guess's first button takes the focus the gone one had. */
  const moved = useRef(false);
  const id = guess?.primaryId;
  const { reset } = m;
  useEffect(() => {
    // The mutation is shared across guesses: a failed save must not show (or be retried) on the next one.
    reset();
    if (!moved.current) return;
    moved.current = false;
    box.current?.querySelector("button")?.focus();
  }, [id, reset]);

  if (!guess) return null;
  const save = (variables: { id: string; status: IdAnswer }) => {
    m.mutate(
      variables,
      {
        onSuccess: () => { moved.current = true; },
        onError: (error) => { console.warn("[grindlog] ids/save_failed", { code: error instanceof ApiError ? error.code : String(error) }); },
      },
    );
  };
  const answer = (status: IdAnswer) => { save({ id: guess.primaryId, status }); };
  const dismiss = () => {
    moved.current = true;
    const next = [...dismissed, guess.primaryId];
    saveDismissed(next);
    setDismissed(next);
  };
  const retry = () => { if (m.variables) save(m.variables); };
  return (
    <section className={styles.card} aria-label="Is this you?" ref={box}>
      <p className={styles.text}>
        Is this you? <strong>{guess.name ?? "No name"}</strong> <span className="muted">· {guess.platform}</span>
      </p>
      <SaveStatus m={{ isSuccess: false, isError: m.isError, submittedAt: m.submittedAt }} retry={retry} />
      <div className={styles.actions}>
        {(["confirmed", "rejected"] as const).map((status) => (
          <button key={status} type="button" className={cx("button", styles.nowrap)} disabled={m.isPending} onClick={() => { answer(status); }}>
            {ANSWER_TEXT[status]}
          </button>
        ))}
        <button type="button" className={styles.close} aria-label="Dismiss" title="Dismiss" onClick={dismiss}>×</button>
      </div>
    </section>
  );
}
