// The installed exe's entry. One exe is the supervisor (what the logon task starts, with
// --supervisor), the tracker (what the supervisor starts, bare) and the launcher (--open from the
// Start menu, --quit from the installer and updater), so Task Manager shows one name and an install
// replaces one file. `bun run start` runs main.ts directly.

/** Which role this process plays. */
export function mode(argv: readonly string[]): "open" | "quit" | "supervisor" | "tracker" {
  const flags = argv.slice(1);
  // --quit first: a mixed command line ends the app rather than starting it.
  if (flags.includes("--quit")) return "quit";
  if (flags.includes("--open")) return "open";
  return flags.includes("--supervisor") ? "supervisor" : "tracker";
}

if (import.meta.main) {
  // Dynamic imports, so the supervisor and the launcher never load the tracker's modules (or open
  // its databases).
  const role = mode(process.argv);
  if (role === "open" || role === "quit") {
    const { runLauncher } = await import("./launcher");
    process.exit(await runLauncher(role));
  } else if (role === "supervisor") {
    const { superviseSelf } = await import("./supervisor");
    superviseSelf();
  } else {
    await import("./main");
  }
}
