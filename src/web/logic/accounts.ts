// The header's account picker: its options, and the value it shows for the saved setting.
import { confirmedIds, MIN_ACCOUNTS, resolveAccount } from "../../shared/accounts";
import { ALL_ACCOUNTS } from "../../shared/schemas/settings";
import type { IdRow } from "../../shared/schemas/responses";

export interface AccountPicker {
  options: { value: string; label: string }[];
  value: string;
}

/** Null (no picker) with fewer than 2 confirmed ids; pending guesses still count under all accounts. */
export function accountPicker(ids: readonly IdRow[], saved: string): AccountPicker | null {
  const confirmed = confirmedIds(ids);
  if (confirmed.length < MIN_ACCOUNTS) return null;
  return {
    options: [
      { value: ALL_ACCOUNTS, label: "All accounts" },
      ...confirmed.map((i) => ({ value: i.primaryId, label: i.name === null ? i.platform : `${i.name} · ${i.platform}` })),
    ],
    value: resolveAccount(ids, saved).account ?? ALL_ACCOUNTS,
  };
}
