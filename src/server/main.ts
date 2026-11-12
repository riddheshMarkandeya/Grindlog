import { createApi, type Api } from "./api";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED } from "./exit-codes";
import { APP_NAME, CHANNEL } from "../shared/channel";
import { startGameWatch, TOAST_TITLE, type GameWatch } from "./game-watch";
import { PortTakenError, startHost, type Host } from "./host";
import { log } from "./log";
import { createLogonTask } from "./logon-task";
import { scheduleMaintenance, type Maintenance } from "./maintenance";
import { createNotifier } from "./notifier";
import { dashboardPort, dataDir, logonTaskName, staticDir, statsConfigDirOverride, updateDir } from "./paths";
import { createQueryReader } from "./query/read";
import { startStatsClient, statsApiUrl, type StatsClient } from "./recorder/client";
import { createRecorder, type Recorder } from "./recorder/recorder";
import { toRecord } from "./records/record";
import { createRecordWriter } from "./records/save";
import { startReleaseRecompute, type ReleaseRecompute } from "./release-recompute";
import { runtimeInfo } from "./runtime-info";
import { VERSION } from "../shared/version";
import { checkStatsConfig, expectedPort, LOCATORS, userIniPath } from "./stats-config";
import { applyStatsFix, runStatsFix, SETUP_CHECK_MS } from "./stats-setup";
import { openStorage, type Storage } from "./storage";
import { trayView } from "./tray-view";
import { disabledReason, UPDATE_KEY } from "../shared/update-key";
import { createUpdates } from "./update/view";

/** What has been started so far: a stop can arrive mid-startup, and tears down only these. */
interface Parts {
  host?: Host;
  storage?: Storage;
  recorder?: Recorder;
  maintenance?: Maintenance;
  releaseRecompute?: ReleaseRecompute;
  client?: StatsClient;
  gameWatch?: GameWatch;
  api?: Api;
}

function main(): void {
  log.info("app", "started", { pid: process.pid, dataDir: dataDir(), ...runtimeInfo() });
  const parts: Parts = {};
  let stopping = false;

  /** Tears down what has started, then exits; the only way out once the host is up. */
  const stop = async (reason: string, code = EXIT_OK) => {
    if (stopping) return; // a signal and the endpoint can arrive together
    stopping = true;
    const steps: [string, () => unknown][] = [
      ["api", () => parts.api?.stop()],
      ["client", () => parts.client?.stop()],
      ["game_watch", () => parts.gameWatch?.stop()],
      // The socket's own close comes too late to run before exit; the last scoreboard is written here.
      ["flush", () => parts.recorder?.flush()],
      // A stopped recompute leaves its marker unwritten, so the next start reruns it in full.
      ["release_recompute", () => parts.releaseRecompute?.stop()],
      ["maintenance", () => parts.maintenance?.stop()],
      ["storage", () => parts.storage?.close()],
      // Last: --quit reads a refused port as nothing left to flush and may then end the supervisor,
      // which takes this process down with it.
      ["host", () => parts.host?.stop()],
    ];
    // Each step on its own: a failed flush must not skip closing storage.
    for (const [step, run] of steps) {
      try {
        await run();
      } catch (err) {
        log.error("app", "stop_failed", { reason, step, err });
      }
    }
    // 0 for any stop the user asked for: it must not look like a crash to the supervisor.
    log.info("app", "stopped", { pid: process.pid, reason, code });
    process.exit(code);
  };
  // SIGHUP: closing the console window, on Windows.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      void stop(signal);
    });
  }

  let url, port;
  try {
    url = statsApiUrl();
    port = dashboardPort();
  } catch (err) {
    log.error("app", "config_invalid", { err });
    process.exit(EXIT_CONFIG_INVALID);
  }

  // The port first, so a second instance leaves before touching migrations or backups. --quit
  // relies on this order too: when the port refuses it ends a supervisor, which takes a starting
  // tracker down with it, and that tracker can't have opened storage yet.
  try {
    parts.host = startHost({ port, logger: log, onShutdown: () => void stop("shutdown") });
  } catch (err) {
    if (err instanceof PortTakenError) {
      log.warn("app", "port_taken", { port });
      process.exit(EXIT_PORT_TAKEN);
    }
    log.error("app", "start_failed", { err });
    process.exit(EXIT_START_FAILED);
  }

  // Before the recorder: startup recovery can finish the first match.
  const notifier = createNotifier({ logger: log });
  let storage, recorder;
  try {
    storage = parts.storage = openStorage();
    let hadMatch = storage.tracker.get<{ any: number }>("SELECT EXISTS (SELECT 1 FROM matches) AS any")?.any === 1;
    const writer = createRecordWriter({ tracker: storage.tracker, logger: log });
    recorder = parts.recorder = createRecorder({
      raw: storage.raw,
      logger: log,
      // A failed write is logged by the recorder as hook_failed; recompute can rebuild it.
      onMatchFinished: (s) => {
        const record = toRecord(s);
        // An ignored playlist's match changed nothing a page shows.
        if (writer.save(record) !== "written") return;
        if (!hadMatch) {
          hadMatch = true;
          log.info("app", "first_match", { guid: record.match.guid });
          void notifier.notify({ title: `${APP_NAME} recorded your first match`, body: "Open the dashboard to see it." });
        }
        // Startup recovery finishes matches before the API exists; no page is open then.
        parts.api?.matchEnded(record.match.guid);
      },
    });
    recorder.recoverAtStartup();
  } catch (err) {
    // openStorage logs its specific failure first.
    log.error("app", "start_failed", { err });
    // Through stop, not a bare return: the host is already listening and would keep a process
    // alive that holds the port and records nothing.
    void stop("start_failed", EXIT_START_FAILED);
    return;
  }

  parts.maintenance = scheduleMaintenance({ storage, isRecording: recorder.isRecording });
  const client = (parts.client = startStatsClient({ url, recorder, logger: log }));
  const expectedWebPort = expectedPort(url);
  // The override reads no install layers either, so results match on any PC and e2e never touches the real ini.
  const configDir = statsConfigDirOverride();
  const gameWatch = (parts.gameWatch = startGameWatch({
    client,
    logger: log,
    expectedWebPort,
    toast: (body) => notifier.notify({ title: TOAST_TITLE, body }),
    checkConfig: () =>
      checkStatsConfig({
        expectedWebPort,
        logger: log,
        locators: configDir === null ? LOCATORS : [],
        ...(configDir !== null && { userDir: () => Promise.resolve({ dir: configDir, foundBy: "override" as const, tried: [] }) }),
      }),
  }));
  if (configDir !== null) log.info("game", "stats_config_override", { dir: configDir });
  // 0 until a release recompute finishes; a crashed run leaves it 0 and logs release_recompute_crashed.
  let recomputeFailed = 0;
  const status = () => {
    const config = gameWatch.statsConfig();
    return {
      connection: client.status(),
      statsApiOff: gameWatch.statsApiOff(),
      configProblems: config?.problems ?? [],
      configUnknown: config === null && gameWatch.statsConfigChecked(),
      statsIni: config ? userIniPath(config) : null,
      expectedWebPort,
      version: VERSION,
      pid: process.pid,
    };
  };
  const updates = createUpdates({ dir: updateDir(), logger: log, running: VERSION, enabled: disabledReason(CHANNEL, VERSION, UPDATE_KEY) === null });
  const api = (parts.api = createApi({
    tracker: storage.tracker,
    reader: createQueryReader({ tracker: storage.tracker, logger: log }),
    status,
    staticDir: staticDir(),
    logger: log,
    logonTask: createLogonTask({ task: logonTaskName(), logger: log }),
    tray: (ack) => trayView({ ...status(), recomputeFailed, update: updates.view() }, notifier.poll(ack)),
    statsSetup: {
      fix: (portConsent) =>
        runStatsFix({ recheck: () => gameWatch.recheck(SETUP_CHECK_MS), apply: (iniPath, want) => applyStatsFix({ iniPath, want, logger: log }), expectedWebPort, portConsent, logger: log }),
    },
    updates,
  }));
  parts.host.mount(api.handle);
  // After the mount, so its end event reaches open pages. Health doesn't wait for it.
  parts.releaseRecompute = startReleaseRecompute({
    storage,
    version: VERSION,
    isRecording: recorder.isRecording,
    onDone: (result) => {
      recomputeFailed = result.failed;
      api.recordsRecomputed();
    },
    logger: log,
  });
}

main();
