// The recap routes. `/recap` finds the newest session under the filter and moves to it; a session's
// pages show the picker, the playlist and teammate filters, the tabs, and the Overview, Matches &
// numbers or one match. The filters live in `?filter=` and `?with=`.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, NavigationType, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";
import { filterValue, type PlaylistFilter as Filter } from "../../../shared/playlist-filter";
import { teammateValue, type TeammateFilter as Teammate } from "../../../shared/teammate-filter";
import { ApiError } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { PlaylistFilter } from "../../components/PlaylistFilter";
import { TeammateFilter } from "../../components/TeammateFilter";
import { parseFilter, parseTeammate, recapReset } from "../../logic/filter-options";
import { recapPath, type RecapView } from "../../logic/recap";
import { useLatestSession, useSessionDetail, useSettings } from "../../queries";
import { redirect, Redirect } from "../../redirect";
import { GuessCard } from "./GuessCard";
import { IconLabel } from "../../components/Icon";
import { cx } from "../../components/cx";
import { useIndicator } from "../../components/useIndicator";
import { Matches } from "./Matches";
import { MatchView } from "./MatchView";
import { Overview } from "./Overview";
import { SessionPicker } from "./SessionPicker";
import { ShareButton } from "./ShareCard";
import styles from "./RecapPage.module.css";

function useRecapFilter(): Filter {
  const [params] = useSearchParams();
  const raw = params.get("filter");
  const fallback = useSettings().recapFilter;
  // Memoized, so effects that depend on the filter run when it changes, not on every render.
  const { filter, bad } = useMemo(() => parseFilter(raw, fallback), [raw, fallback]);
  useEffect(() => {
    if (bad) console.warn("[grindlog] recap/bad_filter", { value: raw });
  }, [bad, raw]);
  return filter;
}

function useRecapTeammate(): Teammate {
  const [params] = useSearchParams();
  const raw = params.get("with");
  const { teammate, bad } = useMemo(() => parseTeammate(raw), [raw]);
  useEffect(() => {
    if (bad) console.warn("[grindlog] recap/bad_with", { value: raw });
  }, [bad, raw]);
  return teammate;
}

/** The h1 of a state with no session to name, so every page has one; hidden, as the header tab shows the name. */
const Title = () => <h1 className="visually-hidden">Recap</h1>;

/** A state with nothing to recap. */
function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <Title />
      <GuessCard />
      <EmptyState title={title}>{children}</EmptyState>
    </>
  );
}

function RecapLoading() {
  return (
    <>
      <Title />
      <Loading label="Loading the session…" className={styles.loading} />
    </>
  );
}

const NOT_ENOUGH = "Not enough data yet. Play a match with the tracker running and its recap appears here.";

export function RecapIndex() {
  const filter = useRecapFilter();
  const teammate = useRecapTeammate();
  const navigate = useNavigate();
  const latest = useLatestSession(filter, teammate);
  const reset = latest.data?.session === null && teammate !== "anyone";
  useEffect(() => {
    if (reset) console.info("[grindlog] recap/with_reset", { with: teammateValue(teammate), reason: "no_session" });
  }, [reset, teammate]);

  if (latest.data?.session) return <Redirect to={recapPath(latest.data.session.key, filter, "overview", teammate)} />;
  // No session with that friend: Anyone, as on a session they aren't in.
  if (reset) return <Redirect to={recapPath(null, filter)} />;
  if (latest.isError) return <Notice title="Couldn't load the recap. Is the tracker running?" />;
  if (!latest.data) return <RecapLoading />;
  // Nothing under this filter: an empty history, or a filter that misses everything played.
  const { playlistsPresent } = latest.data;
  if (!playlistsPresent.length) return <Notice title={NOT_ENOUGH} />;
  return (
    <>
      <Title />
      <GuessCard />
      <div className={styles.bar}>
        <PlaylistFilter value={filter} present={playlistsPresent} onChange={(f) => { void navigate(recapPath(null, f)); }} />
      </div>
      <EmptyState title="No matches under this filter yet." />
    </>
  );
}

export type SessionView = "overview" | "matches" | "match";

export function RecapSession({ view }: { view: SessionView }) {
  const { session = "", guid = "" } = useParams();
  const filter = useRecapFilter();
  const teammate = useRecapTeammate();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useSessionDetail(session, filter, teammate);
  const page = useRef<HTMLDivElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const filterSelect = useRef<HTMLSelectElement>(null);
  const teammateSelect = useRef<HTMLSelectElement>(null);
  const ready = detail.data !== undefined;
  const navigation = useNavigationType();
  const shownFilter = filterValue(filter);
  const shownWith = teammateValue(teammate) ?? "anyone";
  const seen = useRef<{ session: string; filter: string; with: string; view: SessionView; guid: string } | null>(null);
  const here: RecapView = useMemo(() => (view === "match" ? { match: guid } : view), [view, guid]);
  // Whether the pending teammate reset came from a playlist change, whose select keeps the focus.
  const resetByFilter = useRef(false);

  // A friend not on your team in this session (under the playlist filter) goes back to Anyone;
  // replaced, so Back doesn't return to the empty view. Soloqueue stays, as paging lands on sessions
  // with no friend. A pair who never played together in it goes back too.
  const reset = detail.data === undefined ? null : recapReset(teammate, detail.data);
  useEffect(() => {
    if (!reset) return;
    // Runs before the focus effect below, so `seen` still holds the filter before this load.
    resetByFilter.current = seen.current !== null && seen.current.filter !== shownFilter;
    console.info("[grindlog] recap/with_reset", { with: shownWith, session, reason: reset });
    redirect(navigate, recapPath(session, filter, here, "anyone"), location);
  }, [reset, shownWith, shownFilter, session, filter, here, navigate, location]);

  // While a session loads, the loading state replaces the controls, so the one used loses focus to
  // the page. Once a session is on screen, focus that fell there goes to the picker, the h1 naming
  // the session; after a filter change (not Back or Forward), back to that filter's select, as
  // arrowing through a closed select changes it on each key. A teammate reset counts as a change of
  // the select that caused it. Moving between the session's pages unmounts the link used, so focus
  // goes to the open match in the list, or to the open page's tab. Focus anywhere else, or arriving
  // on the page, is left be.
  useEffect(() => {
    if (!ready) return;
    const last = seen.current;
    seen.current = { session, filter: shownFilter, with: shownWith, view, guid };
    // Read once the teammate change has loaded, wherever focus is, so it never outlives its reset.
    const resetFromFilter = last !== null && last.with !== shownWith && resetByFilter.current;
    if (last !== null && last.with !== shownWith) resetByFilter.current = false;
    if (last === null || document.activeElement !== document.body) return;
    const sameSession = last.session === session && last.filter === shownFilter && last.with === shownWith;
    const pushed = navigation !== NavigationType.Pop && last.session === session;
    const filterChange = pushed && last.filter !== shownFilter;
    const withChange = pushed && last.filter === shownFilter && last.with !== shownWith;
    const pageChange = sameSession && (last.view !== view || last.guid !== guid);
    const current = (nav: "rail" | "tabs") => page.current?.querySelector<HTMLElement>(`nav[data-nav=${nav}] [aria-current]`) ?? null;
    let to: "filter" | "with" | "picker" | "rail" | "tab" = "picker";
    let target: HTMLElement | null = pickerButton.current;
    if (filterChange || (withChange && resetFromFilter)) [to, target] = ["filter", filterSelect.current];
    else if (withChange) [to, target] = ["with", teammateSelect.current];
    else if (pageChange) {
      const rail = view === "match" ? current("rail") : null;
      [to, target] = rail ? ["rail", rail] : ["tab", current("tabs")];
    }
    console.debug("[grindlog] recap/focus", { to, navigation, session, filter: shownFilter, with: shownWith, view });
    target?.focus();
  }, [ready, session, shownFilter, shownWith, navigation, view, guid]);

  const gone = detail.error instanceof ApiError && detail.error.status === 404;
  // A failed refetch keeps the session on screen, unless the session is gone.
  if (detail.isError && (gone || !detail.data)) {
    return (
      <Notice title={gone ? "This session isn't here any more." : "Couldn't load this session. Is the tracker running?"}>
        <p><Link to={recapPath(null, filter, "overview", teammate)}>Go to the latest session</Link></p>
      </Notice>
    );
  }
  // Waits for the session rather than showing the last one, whose controls would act on old data.
  if (!detail.data) return <RecapLoading />;

  const d = detail.data;
  return (
    <div data-session={d.key} ref={page}>
      <GuessCard />
      <div className={styles.bar}>
        <SessionPicker detail={d} filter={filter} teammate={teammate} view={view === "overview" ? "overview" : "matches"} buttonRef={pickerButton} />
        <div className={styles.end}>
          <PlaylistFilter value={filter} present={d.playlistsPresent} selectRef={filterSelect} onChange={(f) => { void navigate(recapPath(session, f, here, teammate)); }} />
          <TeammateFilter value={teammate} friends={d.friendsPresent} selectRef={teammateSelect} onChange={(t) => { void navigate(recapPath(session, filter, here, t)); }} />
          {d.summary && <ShareButton detail={d} summary={d.summary} filter={filter} teammate={teammate} />}
        </div>
      </div>
      <RecapTabs session={session} filter={filter} teammate={teammate} view={view} />
      {!d.summary ? (
        <EmptyState title="No matches under these filters in this session." />
      ) : view === "overview" ? (
        <Overview detail={d} summary={d.summary} filter={filter} teammate={teammate} />
      ) : view === "matches" ? (
        <Matches detail={d} filter={filter} teammate={teammate} />
      ) : (
        <MatchView detail={d} filter={filter} teammate={teammate} guid={guid} />
      )}
    </div>
  );
}

function RecapTabs({ session, filter, teammate, view }: { session: string; filter: Filter; teammate: Teammate; view: SessionView }) {
  const nav = useRef<HTMLElement>(null);
  useIndicator(nav, "[aria-current]", "x", view === "overview");
  return (
    <nav ref={nav} className={cx(styles.tabs, "ind-x", "vt-keep")} aria-label="Recap pages" data-nav="tabs">
      <Link to={recapPath(session, filter, "overview", teammate)} aria-current={view === "overview" ? "page" : undefined}><IconLabel k="overview">Overview</IconLabel></Link>
      <Link to={recapPath(session, filter, "matches", teammate)} aria-current={view === "matches" ? "page" : view === "match" ? "true" : undefined}><IconLabel k="matches">Matches &amp; numbers</IconLabel></Link>
    </nav>
  );
}
