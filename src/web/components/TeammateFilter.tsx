import { useState, type Key, type RefObject } from "react";
import { Button, Header, Label, ListBox, ListBoxItem, ListBoxSection, Popover, Select, SelectValue, Text } from "react-aria-components";
import type { TeammateFilter as Filter } from "../../shared/teammate-filter";
import { friendChoices, teammateLabel, toggleFriend, type Together } from "../logic/filter-options";
import styles from "./Select.module.css";

const ANYONE = "anyone";
const SOLO = "solo";

/**
 * The "with teammate" dropdown: Anyone, Soloqueue, then up to two friends ticked, no counts. A tick
 * applies at once and the list stays open for the second; Anyone or Soloqueue clears the ticks and
 * closes. Friends who can't join the ticked one are greyed with the reason. Disabled with no friend
 * to offer, unless it's set, so it can go back to Anyone.
 */
export function TeammateFilter({ value, friends, together, page, onChange, selectRef }: {
  value: Filter;
  friends: readonly { id: string; name: string }[];
  together: Together;
  page: "trends" | "recap";
  onChange: (f: Filter) => void;
  selectRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const choices = friendChoices(value, friends, together, page);
  // Anyone and Soloqueue's keys are the filter values themselves.
  const keys = typeof value === "object" ? [...value.friends] : [value];

  // Multiple mode reports the whole new set; the one key that came or went says what was picked.
  const onKeys = (next: Key[]) => {
    const now = next.map(String);
    const picked = now.find((k) => !keys.includes(k)) ?? keys.find((k) => !now.includes(k));
    if (picked === undefined) return;
    if (picked === ANYONE || picked === SOLO) {
      // Clicking the one already set deselects it in multiple mode; that's no change, so just close.
      const to = picked === ANYONE ? "anyone" : "solo";
      if (to !== value) onChange(to);
      setOpen(false);
      return;
    }
    const to = toggleFriend(value, picked);
    console.debug("[grindlog] with/toggle", { from: value, to, disabledCount: friendChoices(to, friends, together, page).filter((c) => c.disabled).length });
    onChange(to);
  };

  return (
    <Select
      className={styles.select}
      selectionMode="multiple"
      value={keys}
      onChange={onKeys}
      isOpen={open}
      onOpenChange={setOpen}
      isDisabled={friends.length === 0 && value === "anyone"}
      disabledKeys={choices.filter((c) => c.disabled).map((c) => c.id)}
    >
      <Label className={styles.label}>With</Label>
      {/* SelectValue carries the id the button's name points at, so the name reads "Kim + Lee With". */}
      <Button ref={selectRef} className={styles.trigger}><SelectValue>{teammateLabel(value, friends)}</SelectValue></Button>
      <Popover className={styles.pop} placement="bottom start" offset={6}>
        <ListBox className={styles.list}>
          <ListBoxItem id={ANYONE} textValue="Anyone" className={styles.option}>Anyone</ListBoxItem>
          <ListBoxItem id={SOLO} textValue="Soloqueue" className={styles.option}>Soloqueue</ListBoxItem>
          {choices.length > 0 && (
            <ListBoxSection className={styles.section}>
              <Header className={styles.groupHead}>Friends</Header>
              {choices.map((c) => (
                <ListBoxItem key={c.id} id={c.id} textValue={c.name} className={styles.option}>
                  <Text slot="label">{c.name}</Text>
                  {c.reason !== null && <Text slot="description" className={styles.reason}>{c.reason}</Text>}
                </ListBoxItem>
              ))}
            </ListBoxSection>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
