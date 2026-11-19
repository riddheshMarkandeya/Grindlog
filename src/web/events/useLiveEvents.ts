import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribe } from "./client";
import { staleAfterLive } from "../logic/invalidation";
import { createVersionWatch } from "../logic/version-watch";
import { live } from "./live";

// One per page load, outside the effect: StrictMode runs effects twice in dev, and a second watch
// would take the new version as its baseline and miss the change.
const versionChanged = createVersionWatch();

/** Feeds the events stream into the live store and keeps the query cache fresh. */
export function useLiveEvents(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribe((message) => {
        switch (message.type) {
          case "status":
            live.set({ status: message.data });
            break;
          case "link": {
            const wasDown = live.get().link === "down";
            const open = message.link === "open";
            // Open again means whatever this tab's Quit stopped is running again.
            live.set(open ? { link: "open", stopped: false } : { link: message.link });
            // Events sent while the stream was down are lost, and a query that failed on the
            // startup 503 stays failed under staleTime Infinity: refetch everything on reconnect.
            if (open && wasDown) void queryClient.invalidateQueries();
            break;
          }
          case "match_ended":
          case "session_break":
            void queryClient.invalidateQueries({ predicate: staleAfterLive });
            break;
          case "records_recomputed":
          case "seasons_changed":
            // A background recompute may have changed any record, and a season change any season period.
            void queryClient.invalidateQueries();
            break;
          case "version": {
            // The tracker restarted as another release (an update or a rollback): this tab's JS
            // and worker are the old build's, so load the new one. Once per page load.
            const change = versionChanged(message.version);
            if (change !== undefined) {
              console.info("[grindlog] reload/version", { from: change.from, to: message.version });
              location.reload();
            }
            break;
          }
        }
      }),
    [queryClient],
  );
}
