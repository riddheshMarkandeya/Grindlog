# Better dropdowns + duo/trio "With" filter

## Context
The dashboard's four dropdowns are browser-native `<select>`s, which look out of place next to the themed
UI: `PlaylistFilter`, `TeammateFilter` (both `src/web/components/`), `AccountPicker` (header), and the
Settings group pickers (`FilterSelect`, `src/web/pages/settings/SettingsPage.tsx:153`, used by both
"Recap playlist" and "Trends playlist"). Separately, the "With" filter can only be set to one friend from
the UI. The data model and API already take a pair (`TeammateFilter = "anyone" | "solo" | { friends }`,
`src/shared/teammate-filter.ts`; `teammateParam` accepts 1–2 ids sorted by `pairKey`,
`src/shared/schemas/params.ts:24`), but the dropdown offers a pair only when the URL already names one
(`pairOption`, `src/web/logic/filter-options.ts:55`, reached via the Friends-page links in
`src/web/pages/friends/zones.tsx:79-80`). So the trio work is client-side only; no server or schema
change.

Tier: Substantial (a new shared control, more than one approach). Repo plan copy:
`docs/plans/2026-11-22-dropdowns-and-trio.md` (step 0).

## Decisions (user, 2026-11-22: grill-me, then plan review)
1. Dropdown look: **prototype three ways and compare them in the real app** before choosing:
   (A) a styled native `<select>` with `appearance: base-select`; (B) our own component; (C) a
   third-party library (React Aria Components, "RAC"). A is the default the user leaned to.
2. "With Sam" keeps today's meaning: Sam was on your team (another friend may have been too).
3. A trio is picked by **ticking up to two friends**, not from a list of pairs.
4. All four dropdowns get the new look.
5. The With panel holds Anyone, Soloqueue and friend checkboxes.
   - Picking Anyone or Soloqueue clears the ticks.
   - Ticking a friend leaves Anyone/Soloqueue.
   - Unticking the last friend goes back to Anyone.
   - The closed button reads "Sam" or "Sam + Alex".
6. Once one friend is ticked, friends who've never been on your team with them are greyed out. A
   third friend is always greyed once two are ticked. A checked friend is never greyed.
7. Ticks apply right away (the page and URL update), and the panel stays open for the second tick,
   on both Trends and Recap.
8. No counts anywhere in the controls (standing preference).
9. Recap keeps the previous session detail as placeholder data when only `with` changes (same session
   key and playlist), so the panel survives a tick.
   - This revisits the deliberate "waits for the session" rule (`RecapPage.tsx:181`) for that one case.
   - It's safe because `friendsPresent` follows only the playlist filter (`pages.ts:121`): the With
     control's own data isn't stale.
   - Any other key change still shows `RecapLoading`.
10. Trends greys from `useFriendPairs()`, which uses the Friends page's suggestion threshold (3+ matches
   together across 2+ sessions, `pages.ts:257-260`).
   - The user accepted that a duo below the threshold is greyed on Trends, even though `?with=a,b`
     would work.
   - So the greyed reason never claims "never": "Not enough matches with Sam on your team" on Trends,
     "Not on your team with Sam this session" on Recap.
   - Like `offeredFriends`, Trends greying ignores the playlist filter.

Assumptions to confirm at the prototype checkpoint:
- the "With" label stays beside the button;
- Esc or an outside click closes the panel;
- variant A in Firefox shows the plain native dropdown (no `base-select` support yet), and that's
  acceptable.

## Facts found
- `appearance: base-select`: Chrome/Edge 135+. Firefox: not supported. Safari: 27 (sources disagree).
  Unsupported browsers fall back to the native select. `bun run e2e` drives installed Chrome.
- `base-select` can't do multi-select with checkboxes, so in every variant With is a button plus a
  panel.
- RAC `Select` documents `selectionMode="multiple"` (release 2025-10-02). Not installed yet, so
  unverified here.
- Pair data for greying is already on the client:
  - **Trends:** `useFriendPairs()` (`src/web/queries.ts:172`) returns `namedPairs` output,
    `{ pair: { ids, with, … }, a, b }[]` (`src/web/logic/friends.ts:126`). It's undefined while
    loading, and the list is thresholded (decision 10).
  - **Recap:** the session detail's `matches[].friends`. Those matches are already filtered by the
    teammate filter (`pages.ts:117`), so with Sam ticked, the other friends in them are exactly the
    tickable ones.
- Trends keeps its controls mounted across a filter change (`usePlayedDays` keeps the previous data,
  `queries.ts:154`; `TrendsPage.tsx:117`).
- Recap unmounts them (`useSessionDetail`, `queries.ts:81`, has no placeholder; `RecapPage.tsx:182`),
  which is why decision 9 exists.
- Recap focus: `RecapPage.tsx:117,163` holds `teammateSelect: HTMLSelectElement` and focuses it after a
  With change when focus fell to `<body>`. It becomes the With button.
- `pairOption` has one caller (`TeammateFilter.tsx:22`) plus its tests. `TeammateFilter`'s callers are
  exactly `PeriodControls.tsx:56` and `RecapPage.tsx:192`.

## Step 0: save this plan to `docs/plans/2026-11-22-dropdowns-and-trio.md`

## Step 1: prototype (`prototype` skill; throwaway branch `prototype/dropdowns`, never merged)
- The variants switch with `?dd=a|b|c` on Trends and Recap, on the dev server with fixture data.
- Each variant covers the Playlist dropdown (option groups) and the With panel: ticks, greying with
  hard-coded rules, and the "Sam + Alex" label.
- **A:** `base-select` CSS on the existing `<select>`. The With panel is a `popover` with native
  radios and checkboxes.
- **B:** a hand-rolled button and listbox (`role="listbox"`, roving focus, no type-ahead), with the
  same panel.
- **C:** RAC `Select`, single for Playlist and `selectionMode="multiple"` for With. Record the gzipped
  bundle delta (`vite build` before and after).
- All three use the existing tokens (`src/web/styles/tokens.css`), the theme's radius and shadow scale,
  and the current motion level.
- Before the checkpoint, confirm each claim with one line of evidence in the repo plan:
  - RAC multiple selection exists, can host Anyone/Soloqueue items that clear the ticks and close the
    panel, and supports disabled items with a description;
  - Playwright `selectOption` works on a `base-select` select in installed Chrome;
  - the open panel isn't clipped at 320px.
- **Checkpoint:** the user tries all three in Chrome (and A in Firefox, if they want) and picks one.
  Record the pick and its reasons in the repo plan. Only the chosen look is rebuilt properly in step 3.

### Step 1 evidence (2026-11-22, Chrome 157, dev server on the pseudonymised screens db)
- **RAC multiple selection:** `react-aria-components@1.22.1`, `SelectionMode = 'single' | 'multiple'`
  (`react-stately/.../useSelectState.d.ts:6`), `shouldCloseOnSelect` defaults to false in multiple mode.
  Anyone/Soloqueue clear the ticks and close: done by diffing the keys in `onChange` with a controlled
  `isOpen`, seen working in the browser. Disabled items with a description: `disabledKeys` +
  `<Text slot="description">`, seen greyed with the reason line.
  **But the semantics differ:** RAC renders a `listbox` of `option`s, not the radio/checkbox group the
  ARIA contract names. So under C, With would be a multi-select listbox (or a hand-built panel anyway).
- **Bundle:** baseline 190.06 kB gzip; with all three variants 248.98 kB (+58.9 kB, +31%), almost all of
  it RAC (A and B are a few kB of our own code).
- **Playwright `selectOption` on a `base-select` select:** works in installed Chrome; computed
  `appearance` is `base-select`, `toHaveValue("casual")` then `("ranked")` pass.
- **320px:** the open With panel fits in every variant (A and B: left 33, right 287; C: left 12, right 316).
- Prototype notes: A's panel is a native `popover` (light dismiss and Esc for free, positioned by JS);
  B's is a state-driven absolute panel with its own outside-click handling. A's optgroup labels needed
  styling on `optgroup` itself (no `legend` in Chrome's rendering). The Recap placeholder (decision 9)
  is stubbed in the prototype and keeps the panel open through a tick, as planned.

### Step 1 verdict (user, 2026-11-22): **C, React Aria Components**
- Picked after trying all three in the browser. A and B are rejected; all three live on the branch
  `prototype/dropdowns` (commit 4fc63da, never merged).
- **The With panel is RAC's multi-select listbox** (user's choice over a hand-built radio/checkbox panel
  styled like C). That revisits the step 3 "Panel ARIA" rule, which allowed RAC only with radio/checkbox
  semantics: a library-maintained listbox does the job the native-inputs rule was there for (no
  hand-written ARIA). Step 3's ARIA bullets and the contract table below are rewritten for it.
- Accepted costs: about +55 kB gzip for RAC (a localhost dashboard, so load time barely moves), and a new
  runtime dependency.
- The three assumptions stand: the "With" label stays beside the button; Esc or an outside click
  closes; the Firefox caveat no longer applies (RAC draws its own control everywhere).

## Step 2: logic (TDD, red first, in `src/web/logic/filter-options.ts`)
- `toggleFriend(value, id): TeammateFilter`:
  - a tick adds the friend, sorted by `pairKey`;
  - a tick from anyone or solo starts a one-friend filter;
  - unticking the last friend gives anyone;
  - a third tick is ignored.
- `friendChoices(value, friends, together): { id, name, checked, disabled, reason }[]`. A friend is
  disabled if:
  - two friends are ticked and this one isn't; or
  - one friend is ticked and `together(tickedId, id)` is false.

  Checked friends are never disabled.
- `together` builders:
  - `pairsTogether(named: { pair: { ids } }[] | undefined)` for Trends. While it's loading
    (undefined), only the third-friend rule greys anyone.
  - `togetherInMatches(matches)` for Recap: friends seen alongside the ticked one in the shown matches.
- Remove `pairOption` and its tests. Keep `teammateMissing` and `recapReset` (they already handle
  pairs).
- In `src/web/logic/recap.ts`, add `keepDetailWhileWithChanges(prevKey, key, filter)`, a pure
  query-key comparison for decision 9.

## Step 3: controls (in the variant chosen at step 1)
- **Dependency:** `bun add react-aria-components` (1.22.1 in the prototype); pin it exactly like the
  other runtime dependencies.
- **Shared dropdown:** one module, `src/web/components/Select.tsx` + `Select.module.css`, wrapping RAC
  `Select` / `ListBox` / `Popover` with our tokens (the prototype's CSS is the visual reference).
  - It replaces the select in `PlaylistFilter`, `AccountPicker` and `FilterSelect` (both Settings
    pickers).
  - It keeps their labels, values, option groups and `selectRef` focus targets.
- **`TeammateFilter.tsx`:** rewritten on RAC `Select selectionMode="multiple"`, using the step 2
  functions. `onChange` diffs the new keys against the current ones: an added Anyone/Soloqueue (or the
  checked one re-picked) sets that filter and closes the list (controlled `isOpen`); an added or removed
  friend goes through `toggleFriend`.
  - New prop: `together: (a, b) => boolean`.
  - The ref type becomes `HTMLButtonElement`, the RAC trigger button (updated at `RecapPage.tsx:117`;
    the same for `selectRef` on `PlaylistFilter`, `RecapPage.tsx:191`).
  - The disabled rule stays: no friend to offer and value is anyone.
- **With ARIA (RAC, per the step 1 verdict):**
  - RAC's trigger button (`aria-expanded`, labelled "With") opens a `listbox` with
    `aria-multiselectable`; Anyone and Soloqueue are options, friends sit in a section headed "Friends";
  - greyed friends via `disabledKeys`, with `disabledBehavior="selection"` on the `ListBox` so a greyed
    friend stays focusable and its reason (`<Text slot="description">`, which RAC links with
    `aria-describedby`) is announced. Verify both in step 3; if a greyed option can't be focused, say so
    at the step 5 check rather than hand-patching RAC.
- **Callers:**
  - `PeriodControls.tsx:56` passes `pairsTogether(useFriendPairs().data)`;
  - `RecapPage.tsx:192` passes `togetherInMatches(d.matches)`.
- **Recap placeholder (decision 9):** `useSessionDetail` (`src/web/queries.ts:81`) gets a
  `placeholderData` that returns the previous data when `keepDetailWhileWithChanges` holds. Update the
  comment at `RecapPage.tsx:180` to name that one exception.
- **Logging:** `console.debug("[grindlog] with/toggle", { from, to, disabledCount })` on each tick, in
  the existing `[grindlog]` style. It answers which filter a tick produced, and whether greying left
  nobody tickable.

### Interaction contract (With panel)
| Trigger | What shows | Focus |
|---|---|---|
| Click the button / Enter / Space / ↓ / ↑ | The list opens below the button (RAC flips it above if there's no room) | The first selected item, else the first item (RAC) |
| ↑ ↓ / Home / End / type-ahead | Moves through items; greyed friends are focusable but can't be picked (`disabledBehavior="selection"`) | Moves |
| Space / Enter / click on a friend | The tick toggles; the page and URL update; the list stays open | Stays on the item |
| Anyone / Soloqueue | Ticks clear; the filter is set; the list closes | Button |
| Esc / outside click / Tab | The list closes, nothing changes | Button (Esc, outside click); Tab moves to the next control (RAC) |
| A greyed friend | Can't be ticked; reason line shown and announced as its description | — |
| Refetch while the panel is open | It stays open. Trends keeps its controls mounted; Recap keeps the previous detail (decision 9) | Stays on the item |
| Back / Forward | Panel closed; the button label follows the URL | Existing Recap focus rule |
| Friends still loading | Button disabled, as today | — |
| A URL naming a non-friend | The existing `teammateMissing` resets to Anyone (Trends and Recap) | Existing rule |
| A URL naming a pair who never played together | Recap: the existing `recapReset` "not_together". Trends: no reset; the empty state shows, and both stay ticked and can be unticked | Existing rule |

## Step 4: tests
- **Unit (Vitest):** `toggleFriend`, `friendChoices`, `pairsTogether`, `togetherInMatches`,
  `keepDetailWhileWithChanges`.
- **e2e (Chrome):**
  - `test/e2e/friends.spec.ts`: replace `selectOption` on With with a button click and an option click.
  - `test/e2e/friends-page.spec.ts:84,191,195`: replace the `option` / `option:checked` queries, and
    assert the closed button reads "Kim + Lee" after following the pair link.
  - New trio flow, **on Recap and on Trends**. Tick Sammy, then a second friend, and assert:
    - the panel is still open after the first tick;
    - the URL has `with=a,b` and the label reads "Sammy + X";
    - a third friend is greyed, and so is a never-together friend, each with its reason line;
    - unticking both gives Anyone;
    - the `with/toggle` debug line appears (`page.on("console")`).
  - The `accounts`, `recap` and `settings` specs move from `selectOption` to click-and-pick (C won).
    A small helper in `test/e2e/` (open by label, click the option by role and name) keeps that short.
  - The axe check covers the open panel.
  - Run the e2e at 320px too, and assert the open panel fits in the viewport.
- **Manual (residual carve-out, user):** how the open/close motion feels; the Firefox fallback look.

## Step 5: verify and record
- `bun run check`, then `bun run e2e`.
- `/run`, then drive Trends and Recap in Chrome:
  - a keyboard-only pass of the contract table;
  - 320, 768, 1024 and 1440px;
  - no console errors;
  - every theme, oled included.
- CHANGELOG `[Unreleased]`: a new dropdown look, and "With" takes up to two friends.
- Add a PROJECT_INDEX entry for the shared control.
- In BACKLOG's controls-drift item, note that the dropdowns are now one shared set.

### Steps 3–5 evidence (2026-11-22)
- `react-aria-components` pinned at 1.22.1. Bundle 247.03 kB gzip (baseline 190.06, +57 kB, within the accepted cost).
- `bun run check`: green, 1969 unit tests passed, 1 skipped. `bun run e2e`: 152 passed.
- **New e2e seed `trio`** (`test/e2e/stack.ts`): no existing seed had a friend in a session who never
  played with another friend there. Kim and Lee are a pair; Max joins neither. There are 18 friendless
  matches as padding, because Trends needs 20 matches. `test/e2e/trio.spec.ts`, on Recap and Trends:
  - ticking a friend keeps the list open;
  - the URL and the "Kim + Lee" label update;
  - both greying reasons show;
  - axe passes on the open list in every theme;
  - unticking both friends gives Anyone;
  - the `with/toggle` debug line appears on each tick.

  It also checks the keyboard contract (Enter opens on the checked friend, Esc returns focus, Home, and
  Soloqueue closes the list and focuses the button) and that the list fits at 320px.
- **ARIA deviation (report):** `disabledBehavior` isn't exposed on RAC `Select`/`ListBox` 1.22.1 (it's only on
  Table/Tree). Greyed friends are `aria-disabled` and skipped by the arrow keys. Their reason is still
  linked by `aria-describedby` and shown on screen, so a screen reader in browse mode reads it. RAC
  isn't patched.
- **Found while testing:** the CSS `✓`/`▾` glyphs were part of the options' accessible names ("All
  accounts ✓"). They now use `content: "✓" / ""`.
- Settings: the two playlist rows label the button with `aria-labelledby`, not `<label for>`, so
  clicking the row label no longer focuses the dropdown. The Retry focus fallback looks for
  `button[aria-haspopup=listbox]`.
- Recap: the With-only placeholder doesn't run `recapReset` on placeholder data, and the page is
  `aria-busy` while it shows that data.
- Chrome (dev server, screens db): Recap and Trends ticks, the greyed reason, the trio label, OLED, and
  the Settings picker all work, with no console errors. The extension couldn't resize the window, so
  320px rests on the e2e checks; 768 and 1024px weren't checked by hand. Keyboard keys sent through the
  extension were unreliable, so the keyboard contract rests on Playwright.

## Files
- `src/web/logic/filter-options.ts`, `src/web/logic/recap.ts` (+ tests)
- `src/web/queries.ts` (the detail placeholder)
- `src/web/components/TeammateFilter.tsx`, `PlaylistFilter.tsx` + `.module.css`, `AccountPicker.tsx`
  + `.module.css`; a new `Select.tsx` + `Select.module.css`
- `src/web/pages/settings/SettingsPage.tsx` (`FilterSelect`), `src/web/pages/trends/PeriodControls.tsx`,
  `src/web/pages/recap/RecapPage.tsx`
- `test/e2e/friends.spec.ts`, `test/e2e/friends-page.spec.ts`, `accounts`/`recap`/`settings`/`shell` specs,
  new `test/e2e/dropdown.ts` (helper) and `trio.spec.ts`, the `trio` seed in `stack.ts` + `fixtures.ts`
- `package.json`, `bun.lock` (RAC)

## Plan review
Round 1 (plan-reviewer, opus). All findings folded in:
1. **High:** the Recap panel would close, because `RecapLoading` unmounts the controls. The user chose
   placeholder data for a With-only change → decision 9, the step 3 placeholder, and the e2e "panel
   still open after the first tick" on both pages.
2. **High:** the Trends pairs list is thresholded. The user accepted the threshold → decision 10, and
   the reason text doesn't claim "never".
3. **Med:** a contract row claimed a Trends not-together reset → corrected: Trends shows the empty
   state, with no reset.
4. **Med:** `friends-page.spec.ts` option queries → added to step 4 and Files.
5. **Med:** unverified RAC and `selectOption` claims → evidence is required at the step 1 checkpoint.
6. **Med:** no ARIA pattern was named, and `title` isn't reliably announced → a native radio/checkbox
   group in a popover, the reason via `aria-describedby`, and Home/End/Enter rows in the contract.
7. **Low:** the `namedPairs` shape and its loading state, the two Settings pickers, Trends ignoring
   the playlist filter → folded into Facts, step 2, Files and decision 10.
8. **Low:** test seams for the debug log, the trio flow on both pages, clipping at 320px → added to
   step 4.

## Review log

Pre-review (2026-11-22): a user note asked that grouped options be indented under their heading, as
a native optgroup's are. Done with `.section .option { padding-left: 20px }` on both dropdowns, and
seen in Chrome. `bun run check`: typecheck and lint were clean. One unrelated tray-exe timing test
failed under full-suite load and passed 3/3 when run alone (`src/tray` is untouched).

### Round 1 (Substantial by design tier; snapshot `ae63e8b`)

Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify`.

**security: none.**

1. **[Fixed]** The With button's accessible name was only "With" (code-review and arch both found
   it). RAC labels the trigger with `[valueId, labelId]`, and `valueId` only exists on
   `<SelectValue>`.
   - Fix: the label now renders inside `<SelectValue>`.
   - Regression: trio asserts the name "Kim + Lee With", and `dropdown()` now requires a value
     before the label (`^.+ label$`), so every spec checks it.
2. **[Fixed]** Clicking the active Anyone or Soloqueue navigated anyway (multiple mode deselects
   it). On Trends that reset `x`.
   - Fix: no `onChange` when the choice equals the value; the list just closes.
   - Regression: the trio test "clicking the With already set…" (red before the fix:
     `x=date` was lost).
3. **[Fixed]** Recap greyed friends from the placeholder detail's matches, which follow the old
   With: from Soloqueue, ticking Kim greyed Lee (code-review and arch both found it).
   - Fix: while `isPlaceholderData`, `together` is `anyPair`, so only the two-friend cap greys.
     The comment is corrected.
   - Regression: the trio test "Recap while a tick loads…" holds the detail request (red before
     the fix: Lee was `aria-disabled`).
4. **[Fixed]** (nit) While loading, the placeholder kept an enabled Share button, whose card would
   show the old stats under the new With label.
   - Fix: Share hides while `isPlaceholderData`.
   - Regression: same test (red before the fix).
   - The rest of the stale content (a brief "no matches" after a `not_together` reset) is
     **[Verified, no fix needed]**: it's one fetch long, under `aria-busy`, and decision 9 accepted
     it.
5. **[Fixed]** (nit) `.picker button` also sized SaveStatus's Retry button. Fix: it targets
   `[aria-haspopup=listbox]`.
6. **[Fixed]** (nit) The RecapPage focus comments still said "select" and gave the old
   arrow-key reason. Reworded.
7. **[Verified, no fix needed]** (nit) TeammateFilter repeats Select's Button, Popover and ListBox
   skeleton.
   - Kept: the With control is controlled-open, multiple, and has description slots. A shared
     shell would save about 3 lines of JSX for one more component.
   - The shared CSS module keeps the look in one place.
8. **[Verified, no fix needed]** (nit) Trends greying ignores the playlist filter. That's
   decision 10, accepted by the user. The PeriodControls comment already names the threshold.
9. **[Verified, no fix needed]** (nit) The Settings playlist labels no longer focus the dropdown
   when clicked. This is the deviation recorded in the evidence above, and it was reported to the
   user.
10. **Spec drift, no finding:** `keepDetailWhileWithChanges` takes 2 arguments, not 3, and
   `friendChoices` gained `page` for decision 10's per-page reasons.
11. **`/simplify`** ran 4 agents: reuse, simplification, efficiency and altitude.
   - **Applied:**
     - Dropped the unused `FriendChoice.checked`.
     - `togetherInMatches(undefined)` returns "nobody ruled out", like `pairsTogether(undefined)`.
       RecapPage passes `undefined` on placeholder data, which replaces the `anyPair` constant
       (test-first).
     - `keepDetailWhileWithChanges` compares every key part but the last (With), so it doesn't
       hard-code positions 0–2.
     - TeammateFilter's keys come from `[value]`, since Anyone and Soloqueue's keys are the values.
     - `withButton` moved into `test/e2e/dropdown.ts`.
     - Re-wrapped the RecapPage focus comment.
   - **Skipped:**
     - Recomputing `friendChoices` for `disabledCount` in the debug log: the plan asks for that
       field, and friends are under 50.
     - A shared `listClosed` e2e helper: churn.
     - The `SelectLabel` union reshape and RowFrame's `aria-haspopup` selector: fine as they are.
     - A ListBox with `onAction` in place of key-diff decoding: a redesign. Friend ids are
       `Platform|id|n`, so they can't collide with `anyone` or `solo`.
     - `Together` returning a reason in place of `page`: a redesign for a third page that doesn't
       exist.
   - **Raised to the user, not done** (altitude, a §4 revisit of decision 9): keep Recap's bar
     mounted and show loading only in the body, in place of placeholder data. That would remove the
     reset gate, the greying relax and the Share hide.
   - After the edits: `bun run check` passed 1970 (1 skipped); `bun run e2e` passed 154.

### Round 2 (delta `git diff ae63e8b`)

Passes: `correctness-reviewer`, `arch-reviewer` (sonnet), `security-reviewer`.

All three passes came back clean. Every round 1 [Fixed] entry closes with no regression; the
`/simplify` edits hold; nothing else was re-raised. **The review is done: 2 rounds, 6 fixed, 3
verified with no fix needed, 1 raised to the user.**

**Decision 9 revisit (checked 2026-11-22, user asked to do it only if it's the same and simpler):
not done.**
- The bar's controls are built from the session detail: the picker, `playlistsPresent`,
  `friendsPresent`, `matches` (for greying) and `summary` (for Share and the `not_together` reset).
- `matches` and `summary` follow With (`pages.ts` `rowsOf`/`summaries`).
- So a bar kept mounted while a With change loads still needs the previous detail, with the same
  three guards, plus a new body-only loading state. That's not simpler.
- Removing the guards would need a With-independent pairs list per session from the server: a
  bigger change, with nothing calling for it now. Decision 9 stands.
