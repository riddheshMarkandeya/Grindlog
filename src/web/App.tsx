import { useEffect } from "react";
import { Route, Routes, UNSAFE_LocationContext as LocationContext } from "react-router";
import { Header } from "./components/Header";
import { Loading } from "./components/Loading";
import { SetupCard } from "./components/SetupCard";
import { useLiveEvents } from "./events/useLiveEvents";
import { rememberTheme } from "./logic/settings";
import { FriendPage } from "./pages/friends/FriendPage";
import { FriendsPage } from "./pages/friends/FriendsPage";
import { PairPage } from "./pages/friends/PairPage";
import { NotFoundPage } from "./pages/Placeholders";
import { RecapIndex, RecapSession } from "./pages/recap/RecapPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { TrendsPage } from "./pages/trends/TrendsPage";
import { useSettings, useSettingsQuery } from "./queries";
import { Redirect } from "./redirect";
import { useShownLocation } from "./usePageTransition";

/** Applies the theme once it's known; a failed load keeps the theme index.html put back. */
function useTheme() {
  const { data, error } = useSettingsQuery();
  const theme = data?.theme;
  useEffect(() => {
    if (theme === undefined) return;
    document.documentElement.dataset.theme = theme;
    rememberTheme(theme);
  }, [theme]);
  useEffect(() => {
    // The pages carry on with the defaults.
    if (error) console.warn("[grindlog] settings/load_failed", { error: String(error) });
  }, [error]);
}

export function App() {
  useLiveEvents();
  useTheme();
  const { isPending } = useSettingsQuery();
  const { startPage } = useSettings();
  const shown = useShownLocation();
  return (
    <>
      <Header />
      <main>
        {/* Above every page, so the tray's "Set up Stats API…" lands on it wherever the start page is. */}
        <SetupCard />
        {/* The start page and each page's default filter are settings: wait for them once. */}
        {isPending ? (
          <Loading label="Loading" />
        ) : (
          // The pages see the shown location, which a page transition holds back until it renders the
          // new one. The context, not <Routes location>: that form reports every navigation as POP to
          // the pages inside, and the Recap's focus rules read the real type.
          <LocationContext.Provider value={shown}>
            <Routes>
              <Route path="/" element={<Redirect to={`/${startPage}`} />} />
              <Route path="/recap" element={<RecapIndex />} />
              {/* One component for a session's three pages, so moving between them keeps it mounted. */}
              <Route path="/recap/:session" element={<RecapSession view="overview" />} />
              <Route path="/recap/:session/matches" element={<RecapSession view="matches" />} />
              <Route path="/recap/:session/match/:guid" element={<RecapSession view="match" />} />
              <Route path="/trends" element={<TrendsPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/friends/:id" element={<FriendPage />} />
              <Route path="/friends/:a/:b" element={<PairPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </LocationContext.Provider>
        )}
      </main>
    </>
  );
}
