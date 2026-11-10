// The installed exe's entry. One exe is both the supervisor (what the logon task starts, with
// --supervisor) and the tracker (what the supervisor starts, bare), so Task Manager shows one name
// and an install replaces one file. `bun run start` runs main.ts directly.

/** Which role this process plays. */
export function mode(argv: readonly string[]): "supervisor" | "tracker" {
  return argv.slice(1).includes("--supervisor") ? "supervisor" : "tracker";
}

if (import.meta.main) {
  // Dynamic imports, so the supervisor never loads the tracker's modules (or opens its databases).
  if (mode(process.argv) === "supervisor") {
    const { superviseSelf } = await import("./supervisor");
    superviseSelf();
  } else {
    await import("./main");
  }
}
