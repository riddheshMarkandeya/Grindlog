// The recap's right column beside the goal map: By playlist as win/loss bars, then Contribution and
// "Where the touches were", both driven by one mode picker. The pick is this view's own state: kept
// across a filter change when the new data has it, back to the session's default on a remount.
import { useState } from "react";
import { touchesOf } from "../../../shared/lobby";
import type { SessionDetail } from "../../../shared/schemas/responses";
import { Contribution, type Who } from "../../components/Contribution";
import { ModeSwitch } from "../../components/ModeSwitch";
import { PlaylistRecords } from "../../components/PlaylistRecords";
import { Section } from "../../components/Section";
import { TouchThirds } from "../../components/TouchThirds";
import { pctText, plural } from "../../logic/format";
import { carryRest, MODE_LABEL, pickMode, type Mode } from "../../logic/friends";
import type { PlaylistRow } from "../../logic/recap";
import { NO_THIRDS, sessionThirdRows } from "../../logic/thirds";

/** Under this many matches in the mode, the touches note warns that a few swing the split. */
const FEW_MATCHES = 3;

export function PlaylistBars({ rows }: { rows: readonly PlaylistRow[] }) {
  const records = rows.map((r) => ({
    key: String(r.playlistId),
    name: r.name,
    record: r.wins === null || r.losses === null ? null : { w: r.wins, l: r.losses },
    pct: pctText(r.winPct),
  }));
  return <Section title="By playlist"><PlaylistRecords rows={records} /></Section>;
}

type SessionContribution = NonNullable<SessionDetail["contribution"]>;

export function ContributionSections({ contribution, friends }: { contribution: SessionContribution; friends: readonly Who[] }) {
  const modes = contribution.modes.map((m) => m.mode);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode = pickMode(modes, contribution.defaultMode, picked);
  const view = contribution.modes.find((m) => m.mode === mode);
  if (!view) return null;
  const { carry, thirds } = view;
  const label = MODE_LABEL[mode];
  // By the same rule as Contribution's grey end, over this panel's own data: shown whenever it holds a touch.
  const rest = carryRest(mode, friends.length, touchesOf(thirds[friends.length + 1] ?? NO_THIRDS) > 0);
  return (
    <>
      <Section title="Contribution" aside={modes.length === 1 ? <span className="muted">{label}</span> : <ModeSwitch modes={modes} mode={mode} pick={setPicked} />}>
        <Contribution carry={carry} mode={mode} friends={friends} scope="this session" />
      </Section>
      {/* With every match switched, Contribution already says why there's nothing to split. */}
      {carry.matches > 0 && (
        <Section title="Where the touches were">
          <div className="panel">
            {carry.touchMatches === 0 ? (
              <p className="muted">No touch data yet.</p>
            ) : (
              <TouchThirds rows={sessionThirdRows(thirds, friends.map((f) => f.name), rest)}>
                Counted touches over {plural(carry.touchMatches, `${label} match`, `${label} matches`)}, split into thirds from each team's own goal. Hover a bar for the numbers.
                {carry.touchMatches < FEW_MATCHES && " A few matches swing these a lot."}
              </TouchThirds>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
