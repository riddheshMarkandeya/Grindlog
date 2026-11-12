// The Stats API setup card, above every page while the game's settings need fixing. It fixes the
// Documents ini with one click where it can, and falls back to the steps by hand.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SUGGESTED_RATE } from "../../shared/constants";
import { ApiError } from "../api";
import { useLive } from "../events/live";
import { cx } from "./cx";
import type { StatsSetupError } from "../../shared/schemas/responses";
import { outcomeOf, setupCard, type SetupCard as Card, type SetupOutcome } from "../logic/setup";
import { useStatsSetupFix } from "../queries";
import styles from "./SetupCard.module.css";

function Steps({ path, port }: { path: string; port: number }) {
  return (
    <ol className={styles.steps}>
      <li>Open <code className={styles.path}>{path}</code> in Notepad.</li>
      <li>
        Under <code>[TAGame.MatchStatsExporter_TA]</code>, set <code>PacketSendRate={SUGGESTED_RATE}</code> and{" "}
        <code>WebPort={port}</code>.
      </li>
      <li>Save the file.</li>
      <li>Restart Rocket League.</li>
    </ol>
  );
}

const ByHand = ({ card }: { card: Card }) => (
  <details className={styles.more}>
    <summary>Do it by hand</summary>
    <Steps path={card.path} port={card.port} />
  </details>
);

/** Why the guide shows: this tab's failed attempt, or (null) a status with no settings found. */
const GUIDE_WHY: Partial<Record<StatsSetupError | "unknown", string>> = {
  write_failed: "Grindlog couldn't change the settings file itself.",
  check_failed: "Grindlog couldn't find or read Rocket League's settings.",
  // A lost answer: the write may or may not have happened.
  unknown: "Grindlog couldn't confirm the change.",
};

/** Title and body per card; `failed` is this tab's failed attempt, when the card came from one. */
function copy(card: Card, failed: StatsSetupError | "unknown" | null): { title: string; body: ReactNode } {
  switch (card.kind) {
    case "open_game":
      return {
        title: "Open Rocket League once",
        body: "Rocket League creates its settings file the first time it runs. Open it, then come back here to turn on its Stats API.",
      };
    case "guide":
      return {
        title: "Turn on Rocket League's Stats API by hand",
        // no_file and port_needs_consent get their own cards, so never reach here.
        body: (failed && GUIDE_WHY[failed]) ?? GUIDE_WHY.check_failed,
      };
    case "port_warning":
      return {
        title: "Rocket League sends its data to another port",
        body: `Its WebPort isn't ${String(card.port)}, the port Grindlog listens on. If another app, such as an overlay, uses the current port, it stops getting data after this change.`,
      };
    case "fix": {
      const what = [card.rate && `PacketSendRate to ${String(SUGGESTED_RATE)}`, card.webPort && `WebPort to ${String(card.port)}`].filter(Boolean).join(" and ");
      return {
        title: "Turn on Rocket League's Stats API",
        body: `Grindlog gets your match data from it. This sets ${what} in Rocket League's settings file; nothing else changes.`,
      };
    }
    case "restart":
      return { title: "Restart Rocket League", body: "Its settings look right, but no data is arriving. Rocket League reads them only when it starts." };
    case "done":
      return { title: "Done", body: "If Rocket League is open, restart it so it reads the change." };
  }
}

export function SetupCard() {
  const live = useLive();
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const m = useStatsSetupFix();
  const card = setupCard(live, outcome);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // A click's result replaces the card's text: the heading takes focus so it's read out.
  useEffect(() => {
    if (outcome) heading.current?.focus();
  }, [outcome]);

  if (!card) return null;
  const fix = (port: boolean) => {
    m.mutate(
      { port },
      {
        onSuccess: () => { setOutcome({ kind: "done" }); },
        onError: (error) => {
          const code = error instanceof ApiError ? error.code : "unknown";
          console.warn("[grindlog] setup/fix_failed", { code });
          setOutcome(outcomeOf(code));
        },
      },
    );
  };
  const { title, body } = copy(card, outcome?.kind === "failed" ? outcome.code : null);
  const action =
    card.kind === "fix" ? "Turn it on" : card.kind === "port_warning" ? `Change to ${String(card.port)}` : null;
  return (
    <section className={styles.card} data-kind={card.kind} aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      {card.kind === "guide" ? <Steps path={card.path} port={card.port} /> : card.kind !== "done" && <ByHand card={card} />}
      {(action !== null || outcome !== null) && (
        <div className={styles.actions}>
          {action && (
            <button type="button" className={cx(styles.button, styles.primary)} disabled={m.isPending} aria-busy={m.isPending} onClick={() => { fix(card.kind === "port_warning"); }}>
              {m.isPending ? "Changing…" : action}
            </button>
          )}
          {outcome && (
            <button type="button" className={styles.button} onClick={() => { setOutcome(null); }}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </section>
  );
}
