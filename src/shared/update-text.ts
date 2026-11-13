// How the last update ended, in the words the tray and the Settings page both use.
import { RELEASES_LATEST_PAGE } from "./release";
import type { UpdateResponse } from "./schemas/responses";

export function lastApplyText({ outcome, from, to, reason }: NonNullable<UpdateResponse["lastApply"]>): string {
  switch (outcome) {
    case "updated":
      return `Updated to ${to}`;
    case "rolled_back":
    case "rollback_failed":
      // Shown only while the old version runs, so either way it did go back.
      return reason === "low_disk" ? `Update ${to} needed more disk space, so Grindlog went back to ${from}` : `Update ${to} didn't start, so Grindlog went back to ${from}`;
    case "unhealthy":
      return `Update ${to} may not have finished; reinstall if something's wrong`;
  }
}

/** The link that goes with lastApplyText, or null when the line needs none (it already went back). */
export function lastApplyLink({ outcome, to, page }: NonNullable<UpdateResponse["lastApply"]>): { text: string; url: string } | null {
  switch (outcome) {
    case "updated":
      return { text: `What changed in ${to}`, url: page };
    case "unhealthy":
      // The latest release rather than <to>'s page: a fixed release may be out by the time someone reinstalls.
      return { text: "Latest release", url: RELEASES_LATEST_PAGE };
    case "rolled_back":
    case "rollback_failed":
      return null;
  }
}
