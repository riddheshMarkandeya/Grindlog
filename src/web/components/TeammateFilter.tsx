import { useId, type RefObject } from "react";
import { parseTeammate, pairOption } from "../logic/filter-options";
import { teammateValue, type TeammateFilter as Filter } from "../../shared/teammate-filter";
// The same look as the playlist dropdown it sits beside.
import styles from "./PlaylistFilter.module.css";

const ANYONE = "anyone";

/** The "with teammate" dropdown: Anyone, Soloqueue, then the friends offered (and the pair the value names), no counts. Disabled with no friend to offer, unless it's set, so it can go back to Anyone. */
export function TeammateFilter({
  value,
  friends,
  onChange,
  selectRef,
}: {
  value: Filter;
  friends: readonly { id: string; name: string }[];
  onChange: (f: Filter) => void;
  selectRef?: RefObject<HTMLSelectElement | null>;
}) {
  const id = useId();
  const pair = pairOption(value, friends);
  return (
    <div className={styles.filter}>
      <label htmlFor={id}>With</label>
      <select
        id={id}
        ref={selectRef}
        value={teammateValue(value) ?? ANYONE}
        disabled={friends.length === 0 && value === "anyone"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === ANYONE ? "anyone" : parseTeammate(v).teammate);
        }}
      >
        <option value={ANYONE}>Anyone</option>
        <option value="solo">Soloqueue</option>
        {friends.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        {pair && <option value={pair.value}>{pair.label}</option>}
      </select>
    </div>
  );
}

