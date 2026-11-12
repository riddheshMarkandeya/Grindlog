// Every API query the pages share, with their cache keys. Lists live under "sessions"; a session's
// detail, the heavy one, is "session"; one match with every player is "match"; a session's headline
// lines are "remarks"; the Trends page reads "period", "played-days" and "seasons"; every page reads
// "settings"; the Settings page also reads "ids" and "autostart"; the teammate filters and the Friends page read
// "friends", and that page also reads "friend" (one friend's page), "friend-pair" (a pair's),
// "friend-suggestions" and "never-suggest". Page queries take the teammate filter last in their key.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { REQUEST_HEADER } from "../shared/constants";
import { filterValue, type PlaylistFilter } from "../shared/playlist-filter";
import type { PeriodSpec } from "../shared/periods";
import { pairKey, teammateValue, type TeammateFilter } from "../shared/teammate-filter";
import {
  autostartResponse,
  updateResponse,
  currentResponse,
  friendDetailResponse,
  friendsResponse,
  pairDetailResponse,
  neverSuggestResponse,
  suggestionsResponse,
  type FriendSuggestions,
  idsResponse,
  latestResponse,
  matchDetailResponse,
  periodResponse,
  playedDaysResponse,
  remarksResponse,
  seasonsResponse,
  sessionDetailResponse,
  sessionsResponse,
  statsSetupFixed,
} from "../shared/schemas/responses";
import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsPatch } from "../shared/schemas/settings";
import type { IdAnswer, SeasonInput } from "../shared/schemas/tables";
import { getJson, postJson } from "./api";
import { namedPairs } from "./logic/friends";
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

const FRIENDS_KEY = ["friends"] as const;
const SUGGESTIONS_KEY = ["friend-suggestions"] as const;
const NEVER_KEY = ["never-suggest"] as const;
// A PrimaryId has bars, so it's encoded; no nickname clears it.
const friendQuery = (id: string, nickname?: string | null) => new URLSearchParams(nickname ? { id, nickname } : { id }).toString();

const friendsQuery = { queryKey: FRIENDS_KEY, queryFn: () => getJson("/api/friends", friendsResponse) };

/** Every friend, by display name, with both records: the Friends page's cards and the Trends teammate filter. */
export function useFriends() {
  return useQuery({ ...friendsQuery, select: (data) => data.friends });
}

/** The Friends page's pairs with both names, from the same answer as `useFriends` so a friend write keeps them fresh. */
export function useFriendPairs() {
  return useQuery({ ...friendsQuery, select: namedPairs });
}

/** One friend's page; a 404 error when the id isn't a friend (removed, or a stale link). */
export function useFriendDetail(id: string) {
  return useQuery({ queryKey: ["friend", id], queryFn: () => getJson(`/api/friends/detail?${friendQuery(id)}`, friendDetailResponse) });
}

/** A pair's page, the ids in either order (sorted here, so the pair has one cache entry); a 404 error unless both are friends. */
export function usePairDetail(x: string, y: string) {
  const [a, b] = pairKey(x, y);
  return useQuery({ queryKey: ["friend-pair", a, b], queryFn: () => getJson(`/api/friends/pair?${new URLSearchParams({ a, b }).toString()}`, pairDetailResponse) });
}

export function useSuggestions() {
  return useQuery({ queryKey: SUGGESTIONS_KEY, queryFn: () => getJson("/api/friends/suggestions", suggestionsResponse), select: (data) => data.suggestions });
}

export function useNeverSuggested() {
  return useQuery({ queryKey: NEVER_KEY, queryFn: () => getJson("/api/friends/never-suggest", neverSuggestResponse), select: (data) => data.players });
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
function useWholeWrite<V, T>(
  key: readonly [string],
  write: (v: V) => Promise<T>,
  stale?: (query: CachedQuery) => boolean,
  /** Cache edits that must land with the answer, before the caller's own onSuccess (focus, navigation) runs. */
  alsoSet?: (queryClient: QueryClient, v: V) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    // One at a time per key: each answer is the whole thing, so an older one landing last would win.
    scope: { id: key[0] },
    mutationFn: write,
    onSuccess: async (data, v) => {
      // A refetch a reconnect started before the save would land with the old values.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, data);
      alsoSet?.(queryClient, v);
      // Never its own key: the answer just put there is whole.
      if (stale) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== key[0] && stale(q) });
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

/** Drops a suggestion at once, so focus moves to the next one still on screen. */
const dropSuggestion = (queryClient: QueryClient, { id }: { id: string }) => {
  queryClient.setQueryData<FriendSuggestions>(SUGGESTIONS_KEY, (old) => old && { suggestions: old.suggestions.filter((s) => s.id !== id) });
};

export function useAddFriend() {
  return useWholeWrite(FRIENDS_KEY, ({ id }: { id: string }) => postJson(`/api/friends?${friendQuery(id)}`, WRITE, friendsResponse), staleAfterTables, dropSuggestion);
}

export function useNeverSuggest() {
  return useWholeWrite(FRIENDS_KEY, ({ id }: { id: string }) => postJson(`/api/friends/never-suggest?${friendQuery(id)}`, WRITE, friendsResponse), staleAfterTables, dropSuggestion);
}

/** Sets a nickname, or clears it with null. */
export function useSetNickname() {
  return useWholeWrite(FRIENDS_KEY, ({ id, nickname }: { id: string; nickname: string | null }) =>
    postJson(`/api/friends/nickname?${friendQuery(id, nickname)}`, WRITE, friendsResponse), staleAfterTables,
  );
}

/** The removed friend's page and every pair page with them are dropped, not refetched: they'd answer 404. */
export function useRemoveFriend() {
  return useWholeWrite(
    FRIENDS_KEY,
    ({ id }: { id: string }) => postJson(`/api/friends/remove?${friendQuery(id)}`, WRITE, friendsResponse),
    staleAfterTables,
    (queryClient, { id }) => {
      queryClient.removeQueries({ queryKey: ["friend", id] });
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === "friend-pair" && q.queryKey.includes(id) });
    },
  );
}

export function useSuggestAgain() {
  return useWholeWrite(NEVER_KEY, ({ id }: { id: string }) => postJson(`/api/friends/suggest-again?${friendQuery(id)}`, WRITE, neverSuggestResponse), staleAfterTables);
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

const AUTOSTART_KEY = ["autostart"] as const;

/**
 * Whether the logon task starts Grindlog at sign-in. Each read runs schtasks, so it's read once per
 * page load rather than on every focus; a switch answers with the new state.
 */
export function useAutostart() {
  return useQuery({ queryKey: AUTOSTART_KEY, queryFn: () => getJson("/api/autostart", autostartResponse), retry: false, staleTime: Infinity });
}

/** Switches "Run at Windows startup" on or off; the answer is what Windows now holds. */
export function useSetAutostart() {
  return useWholeWrite(AUTOSTART_KEY, (on: boolean) => postJson(`/api/autostart?on=${String(on)}`, WRITE, autostartResponse));
}

const UPDATE_QUERY_KEY = ["update"] as const;

/** The supervisor's latest update check, re-read every 30 s while a page shows it (a check can land any time); that refetch is also the retry. */
export function useUpdate() {
  return useQuery({ queryKey: UPDATE_QUERY_KEY, queryFn: () => getJson("/api/update", updateResponse), retry: false, refetchInterval: 30_000 });
}

/** "Install updates automatically"; the answer is the whole update view. */
export function useSetAutoApply() {
  return useWholeWrite(UPDATE_QUERY_KEY, (on: boolean) => postJson(`/api/update/auto-apply?on=${String(on)}`, WRITE, updateResponse));
}

/** Asks for the ready update to install once Rocket League is closed; a 409 means it's no longer the one available. */
export function useInstallUpdate() {
  return useWholeWrite(UPDATE_QUERY_KEY, (version: string) => postJson(`/api/update/install?${new URLSearchParams({ version }).toString()}`, WRITE, updateResponse));
}

/** The setup card's fix of the game's Stats API settings; `port` consents to moving a custom WebPort. The status catches up over the stream. */
export function useStatsSetupFix() {
  return useMutation({ mutationFn: ({ port }: { port: boolean }) => postJson(`/api/stats-setup/fix${port ? "?port=1" : ""}`, WRITE, statsSetupFixed) });
}
