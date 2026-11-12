// The `bun build --compile` arguments for the one Grindlog exe, shared by the dev install and the
// release build.
import { parseReleaseVersion } from "../src/shared/release";

const PUBLISHER = "Grindlog";

/**
 * The `bun` arguments that compile an entry. Task Manager's Processes tab shows the description, and
 * the title is the same name: it comes from the caller, since the building script's own channel is dev.
 * `defines` replaces bare globals (GRINDLOG_CHANNEL, GRINDLOG_VERSION); only the release build passes them.
 */
export function compileArgs({ entry, outfile, description, icon, version, defines = {} }: { entry: string; outfile: string; description: string; icon: string; version: string; defines?: Record<string, string> }): string[] {
  return [
    "build",
    "--compile",
    "--windows-hide-console",
    "--windows-icon",
    icon,
    "--windows-title",
    description,
    "--windows-publisher",
    PUBLISHER,
    "--windows-description",
    description,
    // A Windows file version is four numbers, so an -rc suffix stays out of it.
    "--windows-version",
    `${parseReleaseVersion(version).numeric}.0`,
    ...Object.entries(defines).flatMap(([k, v]) => ["--define", `${k}=${JSON.stringify(v)}`]),
    entry,
    "--outfile",
    outfile,
  ];
}
