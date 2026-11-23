// The app's single-choice dropdown: React Aria's Select, themed. Keyboard, type-ahead, focus return
// and the listbox semantics come from the library.
import type { Ref } from "react";
import { Button, Header, Label, ListBox, ListBoxItem, ListBoxSection, Popover, Select as RacSelect, SelectValue } from "react-aria-components";
import type { FilterGroup, FilterOption } from "../logic/filter-options";
import styles from "./Select.module.css";

/** A visible label beside the button, a hidden one, or the id of a label rendered elsewhere. */
export type SelectLabel = { text: string; hidden?: boolean } | { labelledBy: string };

export function Select({ label, value, groups, onChange, triggerRef }: {
  label: SelectLabel;
  value: string;
  /** Option groups; a null label is ungrouped. */
  groups: readonly FilterGroup[];
  onChange: (value: string) => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const item = (o: FilterOption) => <ListBoxItem key={o.value} id={o.value} textValue={o.label} className={styles.option}>{o.label}</ListBoxItem>;
  return (
    <RacSelect
      className={styles.select}
      aria-labelledby={"labelledBy" in label ? label.labelledBy : undefined}
      value={value}
      // Single mode with a value set never clears, so null doesn't come up; ignoring it keeps the type honest.
      onChange={(k) => { if (k !== null) onChange(String(k)); }}
    >
      {"text" in label && <Label className={label.hidden ? "visually-hidden" : styles.label}>{label.text}</Label>}
      <Button ref={triggerRef} className={styles.trigger}><SelectValue /></Button>
      <Popover className={styles.pop} placement="bottom start" offset={6}>
        <ListBox className={styles.list}>
          {groups.map((g, i) =>
            g.label === null ? g.options.map(item) : (
              <ListBoxSection key={g.label || i} className={styles.section}>
                <Header className={styles.groupHead}>{g.label}</Header>
                {g.options.map(item)}
              </ListBoxSection>
            ),
          )}
        </ListBox>
      </Popover>
    </RacSelect>
  );
}
