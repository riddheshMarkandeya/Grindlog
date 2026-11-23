// The header's account dropdown: all accounts, or one confirmed id. Only shown with 2 or more.
import { useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { accountPicker } from "../logic/accounts";
import { useIds, useSaveAccount, useSettingsQuery } from "../queries";
import styles from "./AccountPicker.module.css";
import { SaveStatus } from "./SaveStatus";
import { Select } from "./Select";

export function AccountPicker() {
  const ids = useIds().data;
  // Not the defaulted settings: without the saved value the picker could say all over one account's data.
  const saved = useSettingsQuery().data?.account;
  // The pick shows from the change itself: the mutation turns pending a render later, and a second
  // key press in between would start from the saved value. Cleared once its save settles.
  const [picked, setPicked] = useState<string | null>(null);
  const navigate = useNavigate();
  // A session's key is its first match, which the other account may not have: go to its latest. The
  // live location, since the user may have moved while the save was pending; flushed, so the left
  // session isn't refetched into a 404.
  const { m, save: saveAccount } = useSaveAccount(() => {
    if (!window.location.pathname.startsWith("/recap/")) return;
    flushSync(() => { void navigate({ pathname: "/recap", search: window.location.search }, { replace: true }); });
  });
  const picker = ids === undefined || saved === undefined ? null : accountPicker(ids, saved);
  if (picker === null) return null;

  const save = (account: string) => {
    setPicked(account);
    // A failed save falls back to the saved value; a later pick's own save clears it instead.
    saveAccount(account, picker.value, () => { setPicked((p) => (p === account ? null : p)); });
  };
  return (
    <div className={styles.picker}>
      <Select label={{ text: "Account", hidden: true }} value={picked ?? picker.value} groups={[{ label: null, options: picker.options }]} onChange={save} />
      {/* No tick: the pages refetching is the feedback. A failure says so, with a retry. */}
      <SaveStatus m={{ ...m, isSuccess: false }} retry={() => { if (m.variables?.account !== undefined) save(m.variables.account); }} />
    </div>
  );
}
