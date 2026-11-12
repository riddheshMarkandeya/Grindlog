// The Settings page: Appearance, Defaults and Remarks, one row per setting, then Startup (the
// logon task, not a settings row), then the You and Seasons tables. Each change saves at once and
// the row says so ("✓ Saved", or "Couldn't save · Retry"); controls show the stored value, so a
// failed save leaves the old one. Each settings section resets to its defaults. A sticky list of
// links jumps to each section.
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { groupFilter, THEMES, type Settings, type SettingsPatch } from "../../../shared/schemas/settings";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { filterLabel } from "../../logic/filter-options";
import { SPEED_LABEL } from "../../logic/format";
import { parseWindow } from "../../logic/settings";
import type { UpdateResponse } from "../../../shared/schemas/responses";
import { lastApplyText } from "../../../shared/update-text";
import { useAutostart, useInstallUpdate, useSetAutoApply, useSetAutostart, useSettingsQuery, useUpdate } from "../../queries";
import { ApiError } from "../../api";
import { SaveStatus, type SaveState } from "../../components/SaveStatus";
import { codeOf, Section, SECTIONS, TableState, useSave } from "./parts";
import { SeasonsSection } from "./SeasonsSection";
import styles from "./Settings.module.css";
import { YouSection } from "./YouSection";

/** A row's label, help, save status and control, for any write: `m` is its mutation, `save` re-sends a value. */
function RowFrame<V>({ label, help, htmlFor, labelId, m, save, children }: { label: string; help?: string; htmlFor?: string; labelId: string; m: SaveState & { variables: V | undefined }; save: (v: V) => void; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  // A Retry that works disappears; focus goes back to the control it saved, once it shows the new value.
  useEffect(() => {
    if (!m.isSuccess || !retried.current) return;
    retried.current = false;
    const box = row.current;
    (box?.querySelector<HTMLElement>("input:checked") ?? box?.querySelector<HTMLElement>("select, input"))?.focus();
  }, [m.isSuccess]);
  const retry = () => {
    if (m.variables === undefined) return;
    retried.current = true;
    save(m.variables);
  };
  return (
    <div className={styles.row} ref={row}>
      <div className={styles.text}>
        <div className={styles.label}>
          {htmlFor ? <label id={labelId} htmlFor={htmlFor}>{label}</label> : <span id={labelId}>{label}</span>}
          <SaveStatus m={m} retry={retry} />
        </div>
        {help && <div className={styles.help}>{help}</div>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

/** A settings row: its control saves through the settings write. */
function Row({ children, ...frame }: { label: string; help?: string; htmlFor?: string; labelId: string; children: (save: (p: SettingsPatch, onFailed?: () => void) => void) => ReactNode }) {
  const { m, save } = useSave();
  return <RowFrame {...frame} m={m} save={save}>{children(save)}</RowFrame>;
}

/** Native radios drawn as segments (or swatches): arrow keys and the group's name come free. */
function Choice<V extends string>({ labelId, name, value, options, onPick, swatch = false }: { labelId: string; name: string; value: V; options: readonly (readonly [V, string])[]; onPick: (v: V) => void; swatch?: boolean }) {
  return (
    <div role="radiogroup" aria-labelledby={labelId} className={swatch ? styles.swatches : styles.seg}>
      {options.map(([v, text]) => (
        <label key={v} className={swatch ? styles.swatch : undefined}>
          <input type="radio" className={styles.radio} name={name} value={v} checked={value === v} onChange={() => { onPick(v); }} />
          {swatch && (
            <span className={styles.chip} data-theme={v} aria-hidden="true">
              <i />
              <b />
            </span>
          )}
          <span className={styles.choiceText}>{text}</span>
        </label>
      ))}
    </div>
  );
}

function Switch({ labelId, checked, disabled = false, onToggle }: { labelId: string; checked: boolean; disabled?: boolean; onToggle: (on: boolean) => void }) {
  return <input type="checkbox" role="switch" className={styles.switch} aria-labelledby={labelId} checked={checked} disabled={disabled} onChange={(e) => { onToggle(e.target.checked); }} />;
}

/**
 * Typed, then saved on Enter or leaving the field; Esc puts the stored value back. Any settings write
 * that changes them (a save or a reset: `from` is a new object; a refetch with nothing new keeps it)
 * puts the draft back to the stored value too, and so does a failed save.
 * Not remounted on a save, so focus stays in the field.
 */
function WindowInput({ id, stored, from, onSave }: { id: string; stored: number; from: Settings; onSave: (n: number, onFailed: () => void) => void }) {
  const [draft, setDraft] = useState(String(stored));
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(from);
  const revert = () => {
    setDraft(String(stored));
    setError(null);
  };
  if (synced !== from) {
    setSynced(from);
    revert();
  }
  const errId = `${id}-err`;
  const commit = () => {
    const parsed = parseWindow(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.value !== stored) onSave(parsed.value, revert);
  };
  return (
    <div>
      <input
        id={id}
        className={styles.number}
        type="number"
        min={5}
        max={100}
        step={1}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errId}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") revert();
        }}
      />{" "}
      <span className={cx("muted", styles.small)}>matches</span>
      {error && <div id={errId} className={styles.error}>{error}</div>}
    </div>
  );
}

function FilterSelect({ id, value, onPick }: { id: string; value: Settings["recapFilter"]; onPick: (f: Settings["recapFilter"]) => void }) {
  return (
    <select id={id} className={styles.select} value={value} onChange={(e) => { onPick(groupFilter.parse(e.target.value)); }}>
      {groupFilter.options.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}
    </select>
  );
}

const THEME_NAMES: Record<Settings["theme"], string> = { carbon: "Carbon", slate: "Slate", oled: "OLED" };

function Form({ s }: { s: Settings }) {
  const ids = useId();
  const id = (k: string) => `${ids}-${k}`;
  return (
    <>
      <Section anchor="appearance" title="Appearance" intro="How the dashboard looks." reset={{ id: "appearance", s }}>
        <Row label="Theme" labelId={id("theme")}>
          {(save) => <Choice swatch labelId={id("theme")} name="theme" value={s.theme} options={THEMES.map((t) => [t, THEME_NAMES[t]] as const)} onPick={(theme) => { save({ theme }); }} />}
        </Row>
        <Row label="Clock" help="12- or 24-hour times." labelId={id("clock")}>
          {(save) => <Choice labelId={id("clock")} name="clock" value={s.clock} options={[["24h", "24h"], ["12h", "12h"]]} onPick={(clock) => { save({ clock }); }} />}
        </Row>
        <Row label="Speed" help="Hardest shot, fastest goal and the goal map." labelId={id("speed")}>
          {(save) => <Choice labelId={id("speed")} name="speed" value={s.speed} options={[["kmh", SPEED_LABEL.kmh], ["mph", SPEED_LABEL.mph]]} onPick={(speed) => { save({ speed }); }} />}
        </Row>
      </Section>
      <Section anchor="defaults" title="Defaults" intro="What a page shows when you open it." reset={{ id: "defaults", s }}>
        <Row label="Start page" help="Where the dashboard opens." labelId={id("start")}>
          {(save) => <Choice labelId={id("start")} name="startPage" value={s.startPage} options={[["recap", "Recap"], ["trends", "Trends"]]} onPick={(startPage) => { save({ startPage }); }} />}
        </Row>
        <Row label="Recap playlist" help="The recap's filter when you open it." htmlFor={id("recapFilter")} labelId={id("recapFilterL")}>
          {(save) => <FilterSelect id={id("recapFilter")} value={s.recapFilter} onPick={(recapFilter) => { save({ recapFilter }); }} />}
        </Row>
        <Row label="Trends playlist" help="The Trends filter when you open it." htmlFor={id("trendsFilter")} labelId={id("trendsFilterL")}>
          {(save) => <FilterSelect id={id("trendsFilter")} value={s.trendsFilter} onPick={(trendsFilter) => { save({ trendsFilter }); }} />}
        </Row>
        <Row label="Trends rolling window" help="Matches per point when Trends is “By match”. 5–100." htmlFor={id("window")} labelId={id("windowL")}>
          {(save) => <WindowInput id={id("window")} stored={s.rollingWindow} from={s} onSave={(rollingWindow, onFailed) => { save({ rollingWindow }, onFailed); }} />}
        </Row>
      </Section>
      <Section anchor="remarks" title="Remarks" reset={{ id: "remarks", s }}>
        <Row label="Show remarks" help="The mood line and quip, on the recap and the share card." labelId={id("remarks")}>
          {(save) => <Switch labelId={id("remarks")} checked={s.remarks} onToggle={(remarks) => { save({ remarks }); }} />}
        </Row>
        <div className={cx(!s.remarks && styles.off)}>
          <Row label="Mood line" help="How the night went, no numbers." labelId={id("mood")}>
            {(save) => <Switch labelId={id("mood")} checked={s.moodLine} disabled={!s.remarks} onToggle={(moodLine) => { save({ moodLine }); }} />}
          </Row>
        </div>
      </Section>
    </>
  );
}

/** "Run at Windows startup": the logon task itself, read and switched through schtasks, so it loads on its own. */
function StartupSection() {
  const labelId = useId();
  const q = useAutostart();
  const m = useSetAutostart();
  const save = (on: boolean) => {
    m.mutate(on, { onError: (error) => { console.warn("[grindlog] autostart/save_failed", { on, code: codeOf(error) }); } });
  };
  return (
    <Section anchor="startup" title="Startup" intro="How Grindlog runs on this PC.">
      {q.data ? (
        <RowFrame label="Run at Windows startup" help={q.data.state === "unavailable" ? "Couldn't find or read Grindlog's startup task on this PC." : "Starts recording when you sign in to Windows."} labelId={labelId} m={m} save={save}>
          <Switch labelId={labelId} checked={q.data.state === "on"} disabled={q.data.state === "unavailable"} onToggle={save} />
        </RowFrame>
      ) : (
        <TableState what="the startup setting" failed={q.isError} retry={() => { void q.refetch(); }} />
      )}
    </Section>
  );
}

/** Says plainly that update checks are the app's only internet traffic. */
const UPDATES_INTRO = "Grindlog's only internet use: it checks GitHub for new versions every few hours, and installs only ones signed by its developer.";

/** How the last update ended comes first, so a failed one isn't hidden behind "up to date". */
function updateSentence(u: UpdateResponse): string {
  if (u.lastApply === null) return statusSentence(u);
  const last = `${lastApplyText(u.lastApply)}.`;
  return u.status === "up_to_date" ? last : `${last} ${statusSentence(u)}`;
}

function statusSentence(u: UpdateResponse): string {
  switch (u.status) {
    case "disabled": return u.version === null ? "Dev builds don't update." : "This build doesn't update.";
    case "not_checked": return `Grindlog ${u.version ?? ""} hasn't checked for updates yet.`;
    case "up_to_date": return `Grindlog ${u.version ?? ""} is up to date.`;
    case "error": return "Couldn't check for updates. It tries again later.";
    case "skipped": return `Update ${u.skipped ?? ""} was skipped: its signature didn't check out.`;
    case "ready": return `Grindlog ${u.available?.version ?? ""} is ready to install.`;
  }
}

/**
 * The supervisor checks and downloads; this shows what it found and records the friend's choices, which
 * it acts on. Install only asks: the update runs once Rocket League is closed.
 */
function UpdatesSection() {
  const labelId = useId();
  const q = useUpdate();
  const autoApply = useSetAutoApply();
  const install = useInstallUpdate();
  const pending = useRef<HTMLSpanElement>(null);
  const asked = useRef(false);
  const u = q.data;
  // The Install button gives way to the sentence saying when it happens; focus follows it there.
  useEffect(() => {
    if (!u?.installRequested || !asked.current) return;
    asked.current = false;
    pending.current?.focus();
  }, [u?.installRequested]);
  const saveAutoApply = (on: boolean) => {
    autoApply.mutate(on, { onError: (error) => { console.warn("[grindlog] update/auto_apply_failed", { on, code: codeOf(error) }); } });
  };
  const ask = (version: string) => {
    asked.current = true;
    install.mutate(version, {
      onError: (error) => {
        asked.current = false;
        console.warn("[grindlog] update/install_failed", { version, code: codeOf(error) });
        // 409: a newer check replaced it; the fresh view shows what's there now.
        if (error instanceof ApiError && error.status === 409) void q.refetch();
      },
    });
  };
  if (!u) {
    return (
      <Section anchor="updates" title="Updates" intro={UPDATES_INTRO}>
        <TableState what="the update status" failed={q.isError} retry={() => { void q.refetch(); }} />
      </Section>
    );
  }
  const ready = u.available;
  const refused = install.isError && install.error instanceof ApiError && install.error.status === 409;
  return (
    <Section anchor="updates" title="Updates" intro={UPDATES_INTRO}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{updateSentence(u)}</div>
          {ready && u.autoApply && <div className={styles.help}>Installs on its own when Rocket League is closed.</div>}
          {install.isError && <div className={styles.help} role="status">{refused ? "That update isn't available any more." : "Couldn't ask for the install."}</div>}
        </div>
        {ready && (
          <div className={cx(styles.control, styles.updateActions)}>
            {!u.autoApply && (u.installRequested ? (
              <span ref={pending} tabIndex={-1} className={styles.help}>Installs when Rocket League is closed.</span>
            ) : (
              <button type="button" className={styles.button} disabled={install.isPending} aria-busy={install.isPending} onClick={() => { ask(ready.version); }}>Install {ready.version}</button>
            ))}
            <a href={ready.page} target="_blank" rel="noreferrer" className={styles.small}>What changed in {ready.version}</a>
          </div>
        )}
      </div>
      {u.enabled && (
        <RowFrame label="Install updates automatically" help="A ready update installs when Rocket League is closed." labelId={labelId} m={autoApply} save={saveAutoApply}>
          <Switch labelId={labelId} checked={u.autoApply} onToggle={saveAutoApply} />
        </RowFrame>
      )}
    </Section>
  );
}

/**
 * A fragment jump scrolls but doesn't move focus, so the link scrolls and focuses the section's h2
 * itself. The URL keeps no hash: the sections render after their data loads, so a reload couldn't
 * jump back anyway.
 */
function focusSection(e: MouseEvent<HTMLAnchorElement>, anchor: string) {
  // Always ours: a section whose data failed to load has no heading, and is no reason to write a hash.
  e.preventDefault();
  const heading = document.getElementById(anchor);
  heading?.scrollIntoView();
  heading?.focus({ preventScroll: true });
}

export function SettingsPage() {
  // App logs a failed load (settings/load_failed).
  const q = useSettingsQuery();
  return (
    <div className={styles.layout}>
      <h1 className="visually-hidden">Settings</h1>
      <nav aria-label="Settings sections" className={styles.nav}>
        <ul>
          {SECTIONS.map(([anchor, title]) => (
            <li key={anchor}>
              <a href={`#${anchor}`} onClick={(e) => { focusSection(e, anchor); }}>{title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.page}>
        {q.data ? (
          <Form s={q.data} />
        ) : (
          <EmptyState title="Couldn't load your settings.">
            <p>The other pages use the defaults meanwhile. <button type="button" className={styles.link} onClick={() => { void q.refetch(); }}>Retry</button></p>
          </EmptyState>
        )}
        <StartupSection />
        <UpdatesSection />
        <YouSection />
        <SeasonsSection />
      </div>
    </div>
  );
}
