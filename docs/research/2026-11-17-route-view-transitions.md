# Route view transitions without the redirect race (research, 2026-11-17)

Feeds: whether Grindlog (React 19.3.0, react-router 8.4.0 Declarative `<BrowserRouter>`, Vite, Chrome/Edge) can animate page changes (header tabs, recap session/match switches, maybe query-string filters) without bringing back the race that `useTransitions={false}` closed in 4531ee4.
Source tags: **[S]** = stated by the cited primary source; **[I]** = my inference; **[?]** = not verified this session.
Limits: the react-router source was read from the installed 8.4.0 build. `RR/` below means `node_modules/react-router/dist/development/lib/`; `RRdocs/` means `node_modules/react-router/docs/`, the docs shipped with 8.4.0. reactrouter.com currently serves newer docs (8.5.x), and they differ (see Q1). No issue search found a report of this exact race. GitHub search ran through the REST API, since `gh` isn't installed. Nothing was run in a browser.

## Findings first

1. **Fixing `/` alone doesn't make `useTransitions` safe.** The race 4531ee4 reproduced was `RecapIndex`'s `<Navigate replace>` (`src/web/pages/recap/RecapPage.tsx:82`), not App's `/` redirect. The commit names 5 replace-after-async sites [S: `git show 4531ee4`]. Six exist now: `App.tsx:64`, `RecapPage.tsx:82,84,132`, `TrendsPage.tsx:69`, and `FriendPage.tsx:147` (onSuccess) [S: grep].
2. **The supported React Router path needs transitions on, and it's newer than our version.** On reactrouter.com (8.5.x), React's `<ViewTransition>` is the recommended path for all three modes. That page says "do not set `useTransitions={false}`" [S: https://reactrouter.com/how-to/view-transitions, https://unpkg.com/react-router@8.5.1/docs/how-to/view-transitions.md]. The 8.4.0 docs we ship list view transitions for framework and data modes only [S: `RRdocs/how-to/view-transitions.md:7`].
3. **The legacy `viewTransition` prop does nothing under `<BrowserRouter>`.** It is tagged `[modes: framework, data]` [S: `RR/dom/lib.js:283,370`]. Declarative `navigate` passes the options to `history.push(to, state)`, which takes no third argument, so the flag is dropped [S: `RR/hooks.js:295`, `RR/router/history.js:296`]. `useViewTransitionState` throws outside a data router [S: `RR/dom/lib.js:1258-1261`].
4. **The prototype's pattern is the one React Router itself uses.** `RouterProvider`'s legacy view-transition code does `flushSync` → `document.startViewTransition(() => flushSync(setState))`. It calls `skipTransition()` on the running transition when a new navigation interrupts it [S: `RR/components.js:153-178`]. The prototype's version is a hand-rolled copy of that, minus the interruption handling.
5. **The prototype leaves a narrower copy of the race open.** Between the router location changing and the view transition's update callback running, `<Routes>` still renders the old location. A `<Navigate replace>` that renders in that gap replaces the page the user just clicked to [I, from findings 7 and 8].

## Q1. What `useTransitions` does in 8.4, and the view-transition routes in Declarative mode

- **`<BrowserRouter>`** keeps `{action, location}` in `useState`. The history listener calls `setStateImpl(newState)` when `useTransitions === false`, and `startTransition(() => setStateImpl(newState))` otherwise. "Otherwise" includes leaving the prop out (`undefined`) [S: `RR/dom/lib.js:151-174`]. So `useTransitions={true}` and omitting it both put location updates in a transition [S: same lines].
- **`useTransitions={true}`** also wraps `<Link>`/`<NavLink>` clicks in `startTransition` [S: `RR/dom/lib.js:608-627`; `RRdocs/explanation/react-transitions.md:75-95`]. The docs list a third value as "current behavior": state updates in `startTransition`, clicks unwrapped [S: `RRdocs/explanation/react-transitions.md:29,77`].
- **Opting out**: the docs suggest `useTransitions={false}` when an app isn't "Transition-friendly", for example because of `useSyncExternalStore`, whose updates "can't be Transitions" [S: `RRdocs/explanation/react-transitions.md:31-56`]. React Query reads its cache through `useSyncExternalStore` [?]. That fits the 4531ee4 diagnosis: react-query's urgent re-render still saw the old location.
- **React `<ViewTransition>`**: it activates only for updates inside a Transition, `<Suspense>` or `useDeferredValue`. A `flushSync` in the middle makes React skip the animation. React calls `startViewTransition` itself, "so you should never do that yourself". Popstate (Back) updates are not animated [S: https://react.dev/reference/react/ViewTransition]. React Router's 8.5 docs say Back/Forward "may not animate" for the same reason [S: https://unpkg.com/react-router@8.5.1/docs/how-to/view-transitions.md].
- **Legacy API** (`viewTransition` on Link/NavLink/Form, `useViewTransitionState`, NavLink `isTransitioning`): deprecated in 8.5 in favour of `<ViewTransition>`, and framework/data only [S: https://reactrouter.com/how-to/view-transitions]. In data mode it works even with `useTransitions={false}`; that branch calls `setStateImpl` directly inside `startViewTransition` [S: `RR/components.js:213-215`].
- **Open bug on the new path**: on 8.5.0 with React 19.3.1, the router's "loading" commit starts an extra view transition, which delays the page swap and takes the transition types. Reported for framework mode and for data mode with loaders; Declarative isn't mentioned. Open, PR #15691 [S: https://github.com/remix-run/react-router/issues/15670].

## Q2. Redirects during transitions: reports and fixes

- **`<Navigate>` navigates from a passive `useEffect`** after it commits [S: `RR/components.js:419-443`]. Declarative `navigate` calls `history.replace` right away [S: `RR/hooks.js:285-295`]. A replace computed from an old render therefore overwrites whatever entry is current when the effect runs [I].
- **Location lagging by design**: a v7 report found `LocationContext` updating one render late against `useState` set in the same handler. The maintainer answered that "the location is updated within a transition to support Suspense" and closed it. No opt-out was offered then; `useTransitions` came later [S: https://github.com/remix-run/react-router/issues/12552; `RR/../../../CHANGELOG.md` `unstable_useTransitions` entry (#14524)].
- **Related transition timing bugs**: `v7_startTransition` broke native scroll restoration on popstate [S: https://github.com/remix-run/react-router/issues/11030]. Rapid `<Link>` clicks freezing the page is still open [S: issue #15501 title, via the GitHub search API, not read].
- **Found nothing** in react-router issues or discussions for "click undone by a redirect during a transition", nor an official fix [S: GitHub search API, queries `Navigate startTransition` and `startTransition Navigate replace OR redirect`]. The documented alternative is data/framework mode `redirect()` from loaders, which runs before render [?: not re-read this session].
- **Already recorded fix** (BACKLOG Watch list, added in 4531ee4): the redirect checks `window.location.pathname` in its effect at every replace-after-async site [S: `git show 4531ee4 -- BACKLOG.md`].

## Q3. Manual `startViewTransition` + `flushSync` + `<Routes location>`

- **Who uses it**: React Router itself, in `RouterProvider` (finding 4). Chrome's guide names `flushSync` as React's way to apply the update synchronously inside the callback [S: https://developer.chrome.com/docs/web-platform/view-transitions/same-document].
- **`<Routes location>` overrides `LocationContext` for everything under it.** `useRoutesImpl` wraps the rendered matches in a new `LocationContext.Provider` with that location [S: `RR/hooks.js:594-598,616-627`]. So `useLocation`, `useSearchParams` and `useParams` inside pages read `shown`, consistently [S: `RR/hooks.js:89-92`; `RR/dom/lib.js:744`]. Two side effects:
  - `useNavigationType()` inside the pages always returns `"POP"`, because the override hard-codes it [S: `RR/hooks.js:626`].
  - `Header` sits outside `<Routes>`, so its `NavLink` active state follows the real location, a frame or more before the content does [I].
- **Stale location window**: from `history.push` until the update callback, pages see the old location while the URL is new.
  - The spec runs the callback only after capturing the old state, a rendering step later [S: https://drafts.csswg.org/css-view-transitions-1/ §7 setup].
  - `useSearchParams`' setter builds the next query from the stale `searchParams` when given a function [S: `RR/dom/lib.js:747-750`].
  - `useNavigate` resolves relative paths against the stale pathname [S: `RR/hooks.js:279,292`].
  - Absolute targets, which is all the app uses, are unaffected [S: grep above].
  - A `<Navigate replace>` rendered in the window (`RecapIndex`'s query resolving) replaces the new entry. Same shape as the old race, but the window is about a frame instead of a whole transition render [I].
- **Overlapping transitions**: a second `startViewTransition` skips the active one with `AbortError` [S: spec §startViewTransition step 5]. If the skipped transition's callback hadn't run yet, it is still scheduled, in its own task [S: spec §7.5 "skip the view transition", Appendix A]. Each callback closes over its own `location`. As long as A's task runs before B's callback, `shown` ends at the newest location [I].
  - `ready` rejects on a skip, and the spec says rejections "will cause unhandledrejections unless they're handled"; the prototype doesn't catch it [S: spec, `ViewTransition` promise notes].
  - Unlike `RouterProvider`, the prototype doesn't call `skipTransition()` itself; the browser does it on the next start [S: `RR/components.js:155-157`; spec step 5].
  - `InvalidStateError` comes up only if the page is hidden, capture fails, or the viewport size changes [S: spec step 4, §7.6, §7.8].
- **Input during the freeze**: while rendering is suppressed, "all pointer hit testing must target its document element". While animating, captured elements behave like `pointer-events: none` [S: spec]. Chrome: "the page is frozen, so delays here should be kept to a minimum" [S: Chrome guide]. If an update callback never settles, the browser may skip it with `TimeoutError` [S: spec].
- **`flushSync` warnings**: React warns and no-ops only when `flushSync` runs mid-render or inside an effect [S: https://react.dev/reference/react-dom/flushSync]. The prototype calls it inside the view-transition callback, which the browser invokes later [I], as `RouterProvider` does. No warning expected [I]. Caveat: it "may force pending Suspense boundaries to show their fallback" [S: same page]. The app has no Suspense [S: 4531ee4 message].
- **Back/forward**: `popstate` → `history.listen` → the same `setState` [S: `RR/router/history.js:285-294`; `RR/dom/lib.js:166`]. The prototype animates Back too, unlike React `<ViewTransition>` [I]. The browser's native scroll restoration on popstate may run before `shown` updates. The same kind of timing as #11030, not observed here [?].
- **Scroll**: Declarative mode has no `<ScrollRestoration>` (`@mode framework`/`data`) [S: `RR/dom/lib.js:531-540`]. The app doesn't scroll on navigation [S: grep `scrollTo`]. Nothing changes [I].
- **Focus**: the update is a normal React commit, so focus behaves as without the transition. Focus inside removed content falls to `body` either way [I]. Existing focus effects (`RecapPage.tsx:165`, `SessionPicker.tsx:49,123`) run after the `flushSync` commit, inside the callback [I].
- **Mixing with React `<ViewTransition>` later**: React says never call `startViewTransition` yourself [S: react.dev ViewTransition], so the manual pattern and `<ViewTransition>` don't go together [I].

## Q4. Would fixing the redirect make `useTransitions={true}` safe?

- **Rendering the start page at `/`, or redirecting synchronously before render, only fixes `App.tsx:64`.** The failing case was `RecapIndex` (finding 1). `TrendsPage`'s and `RecapSession`'s `navigate(replace)` effects run after react-query data arrives, which is exactly the kind of urgent render that sees a stale location under transitions [S: commit message; I].
- A synchronous redirect at `/` before render needs `startPage` before the settings query resolves [S: `App.tsx:38,59-61`]. That means caching it, e.g. in localStorage [I]. Rendering the start page directly at `/` leaves the URL as `/`, so no header `NavLink` matches [I].
- **What would make it safe** [I]: every replace-after-async site skips its replace when `window.location` no longer matches the location it was computed for. That is the BACKLOG Watch item, which also covers the passive-effect window `useTransitions={false}` leaves open today. It's needed for the prototype pattern too (finding 5).

## Options for Grindlog, ranked

1. **Keep `useTransitions={false}` + the prototype's manual pattern, and add the redirect guard at all 6 sites.**
   - For: no router mode change. Animates Back too. Races are closed by one rule, not by timing. Matches React Router's own implementation.
   - Against: hand-rolled code (~15 lines). Catch `ready`, and optionally call `skipTransition()` on interrupt. `Header` updates before the content.
   - Incompatible with React `<ViewTransition>` later.
2. **CSS enter-only animation keyed on pathname, no View Transitions API.**
   - For: zero race surface. Trivial.
   - Against: no exit or cross-fade; old content disappears at once [I].
3. **React `<ViewTransition>` around `<Routes>`, `useTransitions` back on (omitted or `true`), plus the guard at all 6 sites.**
   - For: the officially recommended path [S: reactrouter.com].
   - Against: brings back transition-time staleness for every urgent render, react-query included. Back doesn't animate. #15670 is open on 8.5. The 8.4 docs don't cover Declarative, so likely an upgrade to 8.5 [I].
   - The guard becomes load-bearing, not belt-and-braces.
4. **Move to Data mode (`createBrowserRouter` + `RouterProvider` from `react-router/dom`), redirects in loaders.**
   - For: redirects before render. Legacy `viewTransition` works even with `useTransitions={false}` [S: `RR/components.js:213-215`].
   - Against: Substantial. Loaders would have to share react-query's cache (e.g. `ensureQueryData`) [?]. The legacy API is deprecated [S].
5. **Fix only `/` and turn transitions on.** Not viable (Q4).

## Inferences

- The gap in finding 5 is about a frame on a fast machine, but the 4531ee4 e2e reproduced the old race under 10x CPU throttling. The same e2e (click Friends while `/api/sessions/latest` is held) should be run against the prototype before relying on it.
- Query-string-only changes (filters) are the riskiest to animate. Pages inside `<Routes>` stay mounted, and functional `setSearchParams` updates read `shown`. The prototype's `routes-only` scope avoids that.
- `useTransitions` omitted ≠ `true` for links, but both reintroduce the race, since the race comes from location state being in a transition (`RR/dom/lib.js:163-164`).

## Open questions

- Does Chrome run a skipped transition's update callback before the new transition's callback? That ordering keeps `shown` at the newest location.
- Does React Query 5 use `useSyncExternalStore`? Not checked against its source.
- Does `<ViewTransition>` in Declarative `<BrowserRouter>` on 8.5 hit #15670's extra commit? No loaders, so probably not, but unverified.
- With the prototype, does native scroll restoration on Back land before or after `shown` updates?
