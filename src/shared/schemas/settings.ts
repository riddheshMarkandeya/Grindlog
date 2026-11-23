// The dashboard's settings: one value each, read when a page renders or a query runs. Stored in
// tracker.db's settings table, one JSON row per key; a key with no row has its default.
import { z } from "zod";
import { ROLLING_WINDOW } from "../trends";

export const THEMES = ["carbon", "slate", "oled"] as const;
/** The group filters (no single playlists): the settings' default filters, and the named half of a filter param. */
export const groupFilter = z.enum(["everything", "ranked", "casual", "extra", "private"]);
/** The `account` setting's value for every account together. */
export const ALL_ACCOUNTS = "all";
const rollingWindow = z.number().int().min(5).max(100);

/** Each setting's stored and served shape, with no defaults: a patch must not fill in the keys it leaves out. */
export const settingFields = {
  theme: z.enum(THEMES),
  clock: z.enum(["24h", "12h"]),
  speed: z.enum(["kmh", "mph"]),
  startPage: z.enum(["recap", "trends"]),
  recapFilter: groupFilter,
  trendsFilter: groupFilter,
  rollingWindow,
  remarks: z.boolean(),
  moodLine: z.boolean(),
  /** Add new seasons from the repo's season file once a day. */
  autoSeasons: z.boolean(),
  /** The account the dashboard shows: "all", or one of your ids (ids contain "|", so they can't be "all"). */
  account: z.string().min(1).max(200),
};

export const settingsSchema = z.object(settingFields);
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  theme: "carbon",
  clock: "24h",
  speed: "kmh",
  startPage: "recap",
  recapFilter: "everything",
  trendsFilter: "ranked",
  rollingWindow: ROLLING_WINDOW,
  remarks: true,
  moodLine: true,
  autoSeasons: true,
  account: ALL_ACCOUNTS,
};

export const SETTINGS_SECTIONS = {
  appearance: ["theme", "clock", "speed"],
  defaults: ["startPage", "recapFilter", "trendsFilter", "rollingWindow"],
  remarks: ["remarks", "moodLine"],
  seasons: ["autoSeasons"],
} as const satisfies Record<string, readonly SettingKey[]>;
export type SectionId = keyof typeof SETTINGS_SECTIONS;
/** Settings changed from the header, not a Settings section, so "reset to defaults" leaves them alone. */
export const HEADER_SETTINGS = ["account"] as const satisfies readonly SettingKey[];

/** The rolling window as a query value: digits only, 5–100. */
export const windowParam = z.string().regex(/^\d{1,3}$/).transform(Number).pipe(rollingWindow);
export const boolParam = z.stringbool({ truthy: ["true"], falsy: ["false"] });

/** A save as `POST /api/settings` takes it, in the query string: any of the keys, at least one, nothing else. */
export const settingsPatch = z
  .object({ ...settingFields, rollingWindow: windowParam, remarks: boolParam, moodLine: boolParam, autoSeasons: boolParam })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, "no settings to save");
export type SettingsPatch = Partial<Settings>;
