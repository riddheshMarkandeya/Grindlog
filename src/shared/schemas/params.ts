// Query parameters as the API accepts them. They check what the query logic trusts: a day is a
// real `YYYY-MM-DD`, a number is a whole number, a filter is one the logic knows.
import { z } from "zod";
import type { PeriodSpec } from "../periods";
import type { PlaylistFilter } from "../playlist-filter";
import type { TeammateFilter } from "../teammate-filter";
import { ROLLING_WINDOW } from "../trends";
import { groupFilter, windowParam } from "./settings";

export const wholeId = z.string().regex(/^\d{1,9}$/).transform(Number);

/** `everything | ranked | casual | extra | private | <playlist id>`, everything when left out. */
export const filterParam = z
  .union([groupFilter, wholeId.transform((playlist) => ({ playlist }))])
  .default("everything") satisfies z.ZodType<PlaylistFilter, string | undefined>;

/**
 * `solo` or one friend's PrimaryId (`Platform|id|split`, so at least two bars), anyone when left
 * out. An id that isn't a friend just matches nothing; the client decides what the dropdown offers.
 */
export const teammateParam = z
  .union([z.literal("solo"), z.string().max(100).regex(/^[^|,]+\|[^,]*\|[^,]*$/).transform((id) => ({ friends: [id] }))])
  .optional()
  .transform((f): TeammateFilter => f ?? "anyone") satisfies z.ZodType<TeammateFilter, string | undefined>;

// From 1000 on: Date maps years 0-99 onto 1900-1999, so an early day would land in the wrong century.
export const dayParam = z.iso.date().refine((day) => day >= "1000-01-01", "year before 1000");

// From 1000 on: Date maps years 0-99 onto 1900-1999.
export const playedDaysParams = z.object({
  year: z.string().regex(/^[1-9]\d{3}$/).transform(Number),
  filter: filterParam,
  with: teammateParam,
});

export const filterOnly = z.object({ filter: filterParam, with: teammateParam });

export const sessionsParams = z
  .object({ filter: filterParam, with: teammateParam, from: dayParam, to: dayParam })
  .refine((p) => p.from <= p.to, { message: "from after to", path: ["to"] });

export const monthsParams = z.object({ filter: filterParam, with: teammateParam, before: dayParam });

// The Trends rolling window: the page sends its setting, so the cached period is keyed by it.
const common = { filter: filterParam, with: teammateParam, window: windowParam.default(ROLLING_WINDOW) };

export const periodParams = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.enum(["day", "week", "month", "year"]), day: dayParam, ...common }),
    z.object({ kind: z.literal("season"), season: wholeId, ...common }),
    z.object({ kind: z.enum(["last7", "last30", "this_year", "all"]), ...common }),
  ])
  .transform((p): { spec: PeriodSpec; filter: PlaylistFilter; with: TeammateFilter; window: number } => {
    const rest = { filter: p.filter, with: p.with, window: p.window };
    switch (p.kind) {
      case "season":
        return { spec: { kind: "season", id: p.season }, ...rest };
      case "day":
      case "week":
      case "month":
      case "year":
        return { spec: { kind: p.kind, day: p.day }, ...rest };
      default:
        return { spec: { kind: p.kind }, ...rest };
    }
  });
