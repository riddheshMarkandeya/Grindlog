import { release } from "node:os";
import { CHANNEL } from "../shared/channel";
import { VERSION } from "../shared/version";

/** Which build and system a process runs on, for every role's `started` log line. */
export function runtimeInfo() {
  // os.release() is "10.0.<build>" on Windows, which tells Windows 10 from 11.
  return { version: VERSION, channel: CHANNEL, windows: release(), bun: Bun.version };
}
