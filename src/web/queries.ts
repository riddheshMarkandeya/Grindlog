// Every API query the pages share, with their cache keys. Lists live under "sessions"; a session's
// detail, the heavy one, is "session"; one match with every player is "match"; a session's headline
// lines are "remarks"; the Trends page reads "period", "played-days" and "seasons"; every page reads
// "settings"; the Settings page also reads "ids"; the teammate filters read "friends". Page queries
// take the teammate filter last in their key.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { REQUEST_HEADER } from "../shared/constants";
import { filterValue, type PlaylistFilter } from "../shared/playlist-filter";
import type { PeriodSpec } from "../shared/periods";
import { teammateValue, type TeammateFilter } from "../shared/teammate-filter";
import {
  currentResponse,
  friendsResponse,
  idsResponse,
  latestResponse,
  matchDetailResponse,
  periodResponse,
  playedDaysResponse,
  remarksResponse,
  seasonsResponse,
  sessionDetailResponse,
  sessionsResponse,
} from "../shared/schemas/responses";
import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsPatch } from "../shared/schemas/settings";
import type { IdAnswer, SeasonInput } from "../shared/schemas/tables";
import { getJson, postJson } from "./api";
import { staleAfterTables, type CachedQuery } from "./logic/invalidation";
import { patchQuery } from "./logic/settings";
import { periodQuery } from "./logic/trends";

/** The header every POST carries; the server refuses writes without it. */
const WRITE = { [REQUEST_HEADER]: "1" };

/** `&with=…` for a teammate filter, encoded as a PrimaryId has bars; nothing for anyone. */
function withQuery(t: TeammateFilter): string {
  const v = teammateValue(t);
  return v === null ? "" : `&with=${encodeURIComponent(v)}`;
}
const withKey = (t: TeammateFilter) => teammateValue(t) ?? "anyone";

/** The current session under "everything", for the header chip and the Start new session button. */
export function useCurrentSession() {
  return useQuery({
    queryKey: ["sessions", "current", "everything"],
    queryFn: () => getJson("/api/sessions/current?filter=everything", currentResponse),
    select: (data) => data.session,
  });
}

/** The newest session under the filters, however old; null when there's none. */
export function useLatestSession(filter: PlaylistFilter, teammate: TeammateFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["sessions", "latest", f, withKey(teammate)],
    queryFn: () => getJson(`/api/sessions/latest?filter=${f}${withQuery(teammate)}`, latestResponse),
  });
}

/** Sessions whose day is in [from, to], newest first. */
export function useSessionList(filter: PlaylistFilter, from: string, to: string, teammate: TeammateFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["sessions", "list", f, from, to, withKey(teammate)],
    queryFn: () => getJson(`/api/sessions?filter=${f}&from=${from}&to=${to}${withQuery(teammate)}`, sessionsResponse),
    select: (data) => data.sessions,
  });
}

/** One session under the filters. */
export function useSessionDetail(key: string, filter: PlaylistFilter, teammate: TeammateFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["session", key, f, withKey(teammate)],
    queryFn: () => getJson(`/api/sessions/${encodeURIComponent(key)}?filter=${f}${withQuery(teammate)}`, sessionDetailResponse),
  });
}

/** One match with every player, for the match page's scoreboard. */
export function useMatchDetail(guid: string, enabled = true) {
  return useQuery({
    queryKey: ["match", guid],
    queryFn: () => getJson(`/api/matches/${encodeURIComponent(guid)}`, matchDetailResponse),
    enabled,
  });
}

const remarksPath = (key: string) => `/api/sessions/${encodeURIComponent(key)}/remarks`;
const remarksKey = (key: string, f: string, teammate: TeammateFilter) => ["remarks", key, f, withKey(teammate)] as const;

/** A session's headline lines under the filters. The server stores them, so a refetch gives the same lines unless the live session moved on. */
export function useRemarks(key: string, filter: PlaylistFilter, teammate: TeammateFilter, enabled = true) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: remarksKey(key, f, teammate),
    queryFn: () => getJson(`${remarksPath(key)}?filter=${f}${withQuery(teammate)}`, remarksResponse),
    // Off, nothing is fetched: the first GET would store a pick for a headline nobody sees.
    enabled,
  });
}

/** ↻: new lines for the session, stored by the server and put straight into the cache. */
export function useRerollRemarks(key: string, filter: PlaylistFilter, teammate: TeammateFilter) {
  const queryClient = useQueryClient();
  const f = filterValue(filter);
  return useMutation({
    mutationFn: () => postJson(`${remarksPath(key)}/reroll?filter=${f}${withQuery(teammate)}`, WRITE, remarksResponse),
    onSuccess: (data) => {
      queryClient.setQueryData(remarksKey(key, f, teammate), data);
      // Cancels a GET a match refetch started before the reroll (it would land with the old lines),
      // and refetches in case a match the POST didn't see landed meanwhile: the stored pick wins.
      void queryClient.invalidateQueries({ queryKey: remarksKey(key, f, teammate) });
    },
  });
}

/**
 * A period under the filter, with the period it's compared with and its buckets. Keyed by today too:
 * cached queries never go stale, and a rolling or running period moves on at the day's cutoff.
 */
export function usePeriod(spec: PeriodSpec, filter: PlaylistFilter, today: string, window: number, teammate: TeammateFilter) {
  const f = filterValue(filter);
  const q = periodQuery(spec).toString();
  return useQuery({
    queryKey: ["period", q, f, today, window, withKey(teammate)],
    queryFn: () => getJson(`/api/period?${q}&filter=${f}&window=${String(window)}${withQuery(teammate)}`, periodResponse),
  });
}

/** The days you played in a year under the filters, and your first day and total whatever the filters. */
export function usePlayedDays(year: number, filter: PlaylistFilter, teammate: TeammateFilter) {
  const f = filterValue(filter);
  const w = withKey(teammate);
  return useQuery({
    queryKey: ["played-days", year, f, w],
    queryFn: () => getJson(`/api/played-days?year=${String(year)}&filter=${f}${withQuery(teammate)}`, playedDaysResponse),
    // Paging the strip's year changes only its ticks, and the first day and total ignore the filters,
    // so the page stays up (controls mounted, focus kept) rather than loading again. New filters'
    // ticks are blank until their load: the old ones would mark days wrongly.
    placeholderData: (prev, prevQuery) => (prev === undefined || (prevQuery?.queryKey[2] === f && prevQuery.queryKey[3] === w) ? prev : { ...prev, days: [] }),
  });
}

/** Every friend, by display name, for the Trends teammate filter. */
export function useFriends() {
  return useQuery({ queryKey: ["friends"], queryFn: () => getJson("/api/friends", friendsResponse), select: (data) => data.friends });
}

const SEASONS_KEY = ["seasons"] as const;
const IDS_KEY = ["ids"] as const;

export function useSeasons() {
  return useQuery({
    queryKey: SEASONS_KEY,
    queryFn: () => getJson("/api/seasons", seasonsResponse),
    select: (data) => data.seasons,
  });
}

export function useIds() {
  return useQuery({ queryKey: IDS_KEY, queryFn: () => getJson("/api/ids", idsResponse), select: (data) => data.ids });
}

/**
 * A write whose answer is the whole of what `key` holds: it goes straight into the cache, then
 * `stale` (if given) marks what else it may have moved.
 */
function useWholeWrite<V, T>(key: readonly [string], write: (v: V) => Promise<T>, stale?: (query: CachedQuery) => boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    // One at a time per key: each answer is the whole thing, so an older one landing last would win.
    scope: { id: key[0] },
    mutationFn: write,
    onSuccess: async (data) => {
      // A refetch a reconnect started before the save would land with the old values.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, data);
      if (stale) void queryClient.invalidateQueries({ predicate: stale });
    },
  });
}

export function useSetIdStatus() {
  return useWholeWrite(IDS_KEY, ({ id, status }: { id: string; status: IdAnswer }) =>
    postJson(`/api/ids?${new URLSearchParams({ id, status }).toString()}`, WRITE, idsResponse), staleAfterTables,
  );
}

/** Adds a season (no id) or edits one. */
export function useSaveSeason() {
  return useWholeWrite(SEASONS_KEY, ({ id, input }: { id: number | null; input: SeasonInput }) =>
    postJson(`/api/seasons${id === null ? "" : `/${String(id)}`}?${new URLSearchParams(input).toString()}`, WRITE, seasonsResponse), staleAfterTables,
  );
}

export function useDeleteSeason() {
  return useWholeWrite(SEASONS_KEY, (id: number) => postJson(`/api/seasons/${String(id)}/delete`, WRITE, seasonsResponse), staleAfterTables);
}

const SETTINGS_KEY = ["settings"] as const;

/** The settings query itself, for the app's first-load gate and the Settings page's error state. */
export function useSettingsQuery() {
  // No retries: the app waits on the first load, and on a failure it should go on with the defaults at once.
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => getJson("/api/settings", settingsSchema), retry: false });
}

/** The settings every page reads; the defaults until they load, or if they can't. */
export function useSettings(): Settings {
  return useSettingsQuery().data ?? DEFAULT_SETTINGS;
}

/** Saves some settings; the answer is all of them, put straight into the cache. */
export function useSaveSettings() {
  return useWholeWrite(SETTINGS_KEY, (patch: SettingsPatch) => postJson(`/api/settings?${patchQuery(patch)}`, WRITE, settingsSchema));
}
