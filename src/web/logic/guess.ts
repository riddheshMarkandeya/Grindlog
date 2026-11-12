// The recap's "Is this you?" card: which unanswered guess it asks about, and the guesses this
// browser dismissed. A dismissal is per player, so a new alt still gets asked.
import type { IdRow } from "../../shared/schemas/responses";
import type { IdAnswer } from "../../shared/schemas/tables";

/** The answer buttons' text, shared by the card and Settings › You. */
export const ANSWER_TEXT: Record<IdAnswer, string> = { confirmed: "That's me", rejected: "Not me" };

/** The first pending row not dismissed, or null. */
export function pickGuess(rows: readonly IdRow[] | undefined, dismissed: readonly string[]): IdRow | null {
  return rows?.find((r) => r.status === "pending" && !dismissed.includes(r.primaryId)) ?? null;
}

export const DISMISSED_KEY = "grindlog.dismissedGuesses";

/** The dismissed primary ids; none when storage is blocked or holds something else. */
export function loadDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Blocked storage or a hand-edited value: the card asks again, which is harmless.
    return [];
  }
}

export function saveDismissed(ids: readonly string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Blocked storage: the dismissal lasts until the page reloads.
  }
}
