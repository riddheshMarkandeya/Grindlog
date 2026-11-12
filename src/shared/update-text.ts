// How the last update ended, in the words the tray and the Settings page both use.
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
