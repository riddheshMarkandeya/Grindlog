// The quick picks, the playlist and teammate filters, the year stepper and the year strip.
import type { PeriodSpec, Season } from "../../../shared/periods";
import type { PlaylistFilter as Filter } from "../../../shared/playlist-filter";
import type { TeammateFilter as Teammate } from "../../../shared/teammate-filter";
import { PlaylistFilter } from "../../components/PlaylistFilter";
import { TeammateFilter } from "../../components/TeammateFilter";
import { quickPicks, specEqual, type TrendsState } from "../../logic/trends";
import { YearStrip } from "./YearStrip";
import styles from "./Trends.module.css";

export function PeriodControls({
  state,
  today,
  seasons,
  year,
  firstDay,
  playedDays,
  selected,
  present,
  friends,
  onPeriod,
  onFilter,
  onTeammate,
  onYear,
}: {
  state: TrendsState;
  today: string;
  seasons: readonly Season[];
  year: number;
  firstDay: string | null;
  playedDays: readonly { day: string; matches: number }[];
  selected: { from: string; to: string } | null;
  present: readonly number[] | null;
  /** Every friend; the teammate filter is disabled with none. */
  friends: readonly { id: string; name: string }[];
  /** `keepYear`: a pick on the strip leaves the strip on its year. */
  onPeriod: (spec: PeriodSpec, keepYear: boolean) => void;
  onFilter: (filter: Filter) => void;
  onTeammate: (teammate: Teammate) => void;
  onYear: (year: number) => void;
}) {
  const thisYear = Number(today.slice(0, 4));
  const firstYear = firstDay ? Number(firstDay.slice(0, 4)) : thisYear;
  return (
    <section className={styles.controls} aria-label="Period">
      <div className={styles.bar}>
        <div className={styles.picks} role="group" aria-label="Quick periods">
          {quickPicks(today).map((p) => (
            <button key={p.label} type="button" aria-pressed={specEqual(p.spec, state.spec)} onClick={() => { onPeriod(p.spec, false); }}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          {present && <PlaylistFilter value={state.filter} present={present} onChange={onFilter} />}
          <TeammateFilter value={state.teammate} friends={friends} onChange={onTeammate} />
        </div>
      </div>
      <div className={styles.stepper}>
        <button type="button" className={styles.step} aria-label="Earlier year" disabled={year <= firstYear} onClick={() => { onYear(year - 1); }}>‹</button>
        <b className="num" aria-live="polite">{year}</b>
        <button type="button" className={styles.step} aria-label="Later year" disabled={year >= thisYear} onClick={() => { onYear(year + 1); }}>›</button>
      </div>
      <YearStrip
        year={year}
        today={today}
        seasons={seasons}
        spec={state.spec}
        selected={selected}
        days={playedDays}
        onPick={(spec) => { onPeriod(spec, true); }}
      />
    </section>
  );
}
