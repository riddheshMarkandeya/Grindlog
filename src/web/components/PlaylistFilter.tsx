import type { RefObject } from "react";
import { filterValue, type PlaylistFilter as Filter } from "../../shared/playlist-filter";
import { filterOptions, parseFilter } from "../logic/filter-options";
import { Select } from "./Select";

/** The playlist dropdown: only the playlists played, grouped, no counts. */
export function PlaylistFilter({ value, present, onChange, selectRef }: { value: Filter; present: readonly number[]; onChange: (f: Filter) => void; selectRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <Select
      label={{ text: "Playlist" }}
      value={filterValue(value)}
      groups={filterOptions(present, value)}
      triggerRef={selectRef}
      onChange={(v) => { onChange(parseFilter(v).filter); }}
    />
  );
}
