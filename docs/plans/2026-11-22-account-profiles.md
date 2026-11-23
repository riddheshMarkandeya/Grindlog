# Account profiles: header dropdown (public release map step 7)

## Context

Players with alts want to see one account's stats on their own. Today every id in `my_ids` that isn't
rejected counts as "you" (`MINE`, `src/server/query/read.ts:22`), so all accounts' matches are mixed.
This is step 7 of `docs/plans/2026-11-18-public-release-map.md` (BACKLOG item "Account profiles"). Tier:
Substantial. Repo rules are in `CONTRIBUTING.md`: tests first, `bun run check` plus `bun run e2e`, and
stat-rule changes go through the registry.

### Decisions (grill-me, 2026-11-20/22, user-confirmed)

1. A header dropdown, next to the Grindlog brand, switches between **All accounts** and one account.
2. It's shown only with 2 or more **confirmed** ids. Pending guesses aren't listed but still count under All.
3. Each account is labelled with its latest in-game name and a platform tag. No nicknames.
4. Picking one account scopes everything: Recap, Trends, Friends, records and the session chip.
5. Your other accounts never count as friends or teammates. In a match view they're ordinary players. It's rare, so no special handling.
6. Sessions: whatever is simplest. Switching accounts mid-session is the user's business.
7. Saved in the server's settings, so it survives restarts. Default: All.
- Assumed: if the saved account is rejected or removed, or fewer than 2 confirmed ids are left, the view falls back to All. Empty data shows the existing empty states. No counts in the dropdown.

## Approach

**Scope the match set rather than "you".** Narrowing `MINE` to the picked id would re-label the other
account's matches as *spectated* and keep them listed. Instead, `MINE` stays as it is (all your ids,
so labels and the friends/teammates exclusion are unchanged), and the reader adds one condition to its
match filter when an account is picked:
`m.guid IN (SELECT match_guid FROM match_players WHERE primary_id = ?)`. That drops the other account's
matches and spectated ones. Every page downstream follows, because the plan review confirmed that all
of them read through the reader: Recap, Trends, the session chip, Friends cards, detail, pairs and
suggestions, and remarks. The tray reads no matches.

- **Sessions** are cut from the picked account's matches, because `pages.ts` `index()` cuts over
  `readResults()`. That's decision 6 ("simplest"): no session code changes. Session keys (the guid of the
  first match) can shift or vanish on a switch, so a switch made on `/recap/:key` goes to the latest
  session (step 7).
- `readGoals(guids)` needs no change: `pages.ts:140` passes guids from the already-scoped matches.
- `readMatch` (one match by guid) stays unscoped, so a direct link to any match still opens.
  `MatchView.tsx:215-225` already handles its null `sessionKey`.
- `pickMe` prefers the picked id when one is set (one line, before the camera rule), so in the rare
  both-ids match the picked account is "you".
- `friends.ts:27` (no adding your own id as a friend) stays on all ids.

**Effective account**, the one place the fallback lives: `effectiveAccount(saved)` in
`src/server/ids.ts` returns the id when `saved` is a confirmed id and there are 2 or more confirmed
ids, else `null` (All). The web helper mirrors it. Both unit tests run one shared case table
(`src/shared/account-cases.ts`, or a fixture both import) so the rules can't drift.

## Steps

1. Copy this plan to `docs/plans/2026-11-22-account-profiles.md`.
2. **Setting.** `src/shared/schemas/settings.ts`: `account: z.string().min(1).max(200)` in
   `settingFields`, default `"all"`. `"all"` can't collide with an id, because ids contain `|`.
   `patchQuery` already URL-encodes `|`. The key isn't added to `SETTINGS_SECTIONS`, because sections
   drive Settings' "reset to defaults" (`web/logic/settings.ts:5-7`) and a reset shouldn't flip the
   account. Export `HEADER_SETTINGS = ["account"] as const` beside it, and make
   `settings.test.ts:5-9` check sections + header keys = all keys.
3. **Rule** (CONTRIBUTING "Changing a stat rule"): edit `your_row` (`src/server/rules/registry.ts:461`).
   Add: "With an account picked in the header, only matches that id played count; it is you there
   even beside another id of yours." Bump it to version 2, run `bun run rules-diff` (expect no stored
   match to move: the rule is read-time), then `bun run definitions`.
4. **ids.ts** (TDD): `effectiveAccount(saved: string): string | null`. It logs
   `ids/account_fallback {saved, reason}` (`reason`: `not_confirmed` or `too_few`), deduped on
   `saved|reason` per run. Ids already appear in local logs (`ids/status`, `settings/saved`), and the
   privacy rules cover commits, so no extra redaction.
5. **Latest names** (decision 3): the `GET /api/ids` handler (`api/index.ts:234`) overlays
   `reader.readLastNames(ids)` (`read.ts:497`) on `ids.list()`'s names, falling back to `my_ids.name`.
   That reuses the existing query, and keeps `ids.ts` reading `my_ids` only. Settings' You table shows
   latest names too. Known fallout: `rich`'s You row becomes `Epic|me|0` (the seeded player name
   defaults to the key, `src/server/testing.ts:47`). Update `settings-tables.spec.ts:62,95,216` and the
   `api.test.ts` name expectations, or give the seed a real name.
6. **read.ts** (TDD): `createQueryReader({ tracker, logger, account = () => null })`, with the default so
   the 9 existing callers are unchanged. It returns `account` as well.
   - `where()` takes an optional `account` and adds the condition above.
   - `resultRows()` gets a `where`, too (today it reads every match).
   - `readMyMatches`, `readLobbies`, `readResults`, `readTeammates` and the `othersIn` calls all build
     their filter through one local `scoped(range)`, which calls `account()` once per read.
   - `pickMe` gets the picked id first.
   - `timed`'s log line gains `account: boolean`.
7. **Wiring and remarks.** `src/server/main.ts`: move `createSettings` up (`:213`) and add a
   `createIds` before the reader (`:184`). Pass `account: () => ids.effectiveAccount(settings.get().account)`.
   `createApi` keeps its own stateless stores. `pages.ts` exposes `account: reader.account`, and
   `src/server/remarks/store.ts` `keyOf` appends `|acct:<id>` when `pages.account()` is non-null, so one
   account's stored pick isn't shown for another. Under All the key is unchanged, so stored picks still
   match. Add a remarks test with a reader whose account is set.
8. **Web** (TDD for the logic):
   - `src/web/logic/accounts.ts`: `accountPicker(ids, saved)` returns
     `{ options: {value, label}[], value } | null`. It returns null with fewer than 2 confirmed ids. Labels
     read `Name · Platform` (or the platform alone when there's no name), in added order, with
     `All accounts` first. `value` falls back to `"all"` by the shared rule.
   - `src/web/queries.ts`: `useSaveSettings(stale?)` gains an optional `stale` that passes through to
     `useWholeWrite`. The picker calls `useSaveSettings(staleAfterTables)`. Update the comment in
     `invalidation.ts` (lines 1-2, 12-16) so it names the account switch.
   - `src/web/components/AccountPicker.tsx` (+ `.module.css`): a native `<select>`, styled like
     `PlaylistFilter.module.css`, with a visually hidden `<label>Account</label>`. The value shows
     `mutation.variables.account` while the save is pending, else the derived value. On success, if the
     route is `/recap/:key`, it navigates to `recapPath(null, …)` (latest session, keeping the
     playlist/teammate params). Rendered in `Header.tsx` right after the brand. Renders nothing when
     `accountPicker` is null.
9. **e2e**: a new `accounts` seed in `test/e2e/stack.ts`: `rich` plus `ALT` confirmed, with a few
   matches played as ALT. New `test/e2e/accounts.spec.ts`:
   - Picking ALT shows only ALT's matches on Recap.
   - A switch made on an older session URL lands on the latest session, not the "gone" notice.
   - Reload keeps the pick; All restores everything.
   - The `rich` seed shows no picker.
   - axe in the three themes, and a 320px check of the header.

   Check that `settings-tables.spec.ts` and `recap-guess.spec.ts:35-48` still pass: each confirms a
   guess, so the picker appears mid-test.
10. Real-browser pass (`/run` plus Claude in Chrome) at 320, 768, 1024 and 1440px. Keyboard only, no console errors.
11. Docs: `PROJECT_INDEX.md` entries (setting, picker, reader scope), close the BACKLOG item, and
    mark release map step 7. The commit body records why the match set is scoped instead of "you", and
    that sessions are per account.

### Interaction contract

| Trigger | What shows | Focus |
|---|---|---|
| Pick an account | The select shows the pick at once (pending variables); on success every page refetches (existing loading model) | Stays on the select |
| Pick while on `/recap/:key` | After the save: the latest session for that account, with filters kept | Stays on the select |
| Save fails | The select reverts to the saved value; existing write-error handling | Stays |
| Reload / next launch | The saved account, or All after a fallback | — |
| Confirm/reject an id in Settings | Picker appears or disappears; a rejected picked id falls back to All | — |
| Back/Forward | The account doesn't change (it isn't in the URL) | — |
| Live match lands (SSE) | Existing refetch, scoped by the same setting | — |

## Verification

- `bun run check` (typecheck, lint with 0 warnings, unit tests; the definitions sync test covers step 3) and `bun run e2e`.
- Unit tests:
  - Reader with ME and ALT matches: under All, both are listed. Picked ALT: only ALT's, with spectated
    ones dropped, Friends and teammates from ALT's matches only, and ALT is "you" in a both-ids match.
    Picked but rejected: All.
  - The shared `effectiveAccount` / `accountPicker` cases. `/api/ids` latest names. Remarks key with an account.
- Manual: the dev install, or the e2e `accounts` seed with `GRINDLOG_E2E_KEEP=1`. Switch accounts and read
  the `ids/account_fallback` and `query/read {account}` log lines.

## Plan review

Round 1 (plan-reviewer, opus). All findings folded in:
1. A switch on a session URL hits "gone" → navigate to latest on switch, plus a contract row and an e2e test (steps 8, 9).
2. `your_row` changed without the registry → rule edit, version bump, rules-diff, definitions (step 3); `pickMe` prefers the picked id.
3. The remarks wiring didn't match the code → `pages.account()`, no `ApiOptions` change, no store sharing (step 7).
4. Required reader option breaks 9 callers → default `() => null` (step 6).
5. The contract claimed an optimistic update → show pending variables; reuse `useSaveSettings` with a `stale` argument (step 8).
6. More e2e tests are affected (`recap-guess`, the You row rename) → listed (steps 5, 9).
7. Duplicated latest-name query → reuse `readLastNames` (step 5).
8. The "don't log the id" claim was undone by `settings/saved` → dropped; dedupe `account_fallback` on `saved|reason` (step 4).
9. Two copies of the fallback rule → one shared case table (Approach).

## Results (2026-11-22)

Implemented as planned, with these departures:
- **One rule, not two copies.** `src/shared/accounts.ts` `resolveAccount` is the fallback rule itself;
  `ids.effectiveAccount` (server) and `accountPicker` (web) both call it, so no shared case table is needed.
- **No `stale` argument on `useSaveSettings`.** The first e2e run caught a real ordering bug: the save's
  invalidation refetched the session being left (two 404s in the console) before the move to `/recap`. A new
  `useSaveAccount` (`queries.ts`) does it in order instead: drop the cached latest session, `flushSync` the route
  change, then invalidate with `staleAfterTables`. It runs once the last pick settles, whenever the saved account
  differs from the one shown before (review round 1).
- **The move to `/recap` keeps the whole query string**, not only the playlist and teammate params through
  `recapPath`: those are the only params a session page has, so the result is the same.
- **The pick is local state, not the mutation's pending variables.** In the real browser, two quick arrow presses
  saved the first option only: React re-rendered the controlled select with the saved value before the mutation
  turned pending, so the second press started from the old value. Seen red with the old code and green with the
  fix in Chrome (`change` events `me, me` before the fix, `me, alt` after). Playwright's key presses are too slow
  to hit the window (the old code passes), so this check stays manual.
- `codeOf` moved from `pages/settings/parts.tsx` to `web/api.ts`, beside `ApiError`, so the header doesn't import
  from a page.
- `rules-diff` against the dev data: 348 recomputed, no change (the rule applies at read time).

Verification:
- `bun run check`: typecheck, lint with 0 warnings, 1958 unit tests passed (134 files).
- `bun run e2e`: 147 passed, 1 failed: `season-file.spec.ts` timed out under full-suite load. It passed 4 of 4 runs
  alone; BACKLOG item filed. After the picker's later fixes, `accounts`, `settings-tables` and `recap-guess`
  passed again (18 of 18).
- Real browser (accounts seed, Chrome): picking by keyboard keeps focus on the select. A switch on
  `/recap/e2e-seed-won` lands on ALT's `e2e-alt-0`, the session chip hides, and the console shows no errors.
  320 and 768px screenshots (Playwright, because the Chrome window wouldn't shrink): the header wraps with no
  horizontal scroll. Both are also covered by the e2e 320px check and the axe check in three themes.

## Review log

### Round 1 (snapshot `e5e0eba`)

Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`. Tier Substantial by design (232
non-test lines changed). `/simplify` follows.

- arch: `remarks/store.ts:26` has a stale JSDoc stacked above the new one on `keyOf`. [Fixed] Deleted.
- arch: `AccountPicker.tsx` passes callbacks to `mutate`, but those run only for the observer's last call. If the
  first of two quick picks saves and the second fails, no page refreshes. [Fixed] `useSaveAccount` in
  `queries.ts` runs on the last pick's settle and compares the cached saved account with the one shown before
  the pick. This settles the plan's question about "invalidation tied to each mutation".
- arch + code-review: `onSuccess` reads `location` from the render of the pick, so a move while the save is
  pending is missed. [Fixed] It now reads `window.location` (no router basename).
- arch: the `["sessions", "latest"]` key is copied into a component. [Fixed] It's now `LATEST_SESSION_KEY`, and
  the cache work lives in `queries.ts`.
- arch: the Results section doesn't record the `recapPath` departure. [Fixed] Recorded.
- arch: `web/logic/accounts.ts` repeats the confirmed filter. [Fixed] `confirmedIds` is exported (generic) and
  reused.
- arch: the `main.ts` comment "both are stateless" no longer holds. [Fixed] Reworded.
- code-review (important): a second open tab keeps its old picker value while its pages, refetched on the next
  match, follow the new account. [Deferred → BACKLOG] The interaction contract doesn't cover multiple tabs, and
  nothing is lost: a reload corrects it. It goes on the Watch list.
- code-review: the header shows All while the settings query has no data (loading or failed), although the
  server is scoped. [Fixed] The picker renders nothing until the settings query has data.
- code-review: `settings.get()` now runs on every scoped read, so one bad stored row logs `bad_stored` on every
  read. [Fixed] Logged once per key and reason per run, with the test extended (red, then green).
- security: no findings.

After the fixes: `bun run check` passed (1958 tests). `bun run e2e accounts settings-tables recap-guess shell`
passed 29 of 29.

`/simplify` (4 angles), applied:
- `createOnce()` in `server/log.ts` replaces 4 hand-written once-per-run Sets: `recorder.ts`, both in `ids.ts`, and
  the new `bad_stored` one in `settings.ts`.
- `main.ts` passes its `settings` and `ids` stores into `createApi` (new optional `ApiOptions` fields), so a
  once-per-run line isn't logged once per instance.
- `effectiveAccount`'s query is typed as `Pick<IdRow, …>`, and the e2e `afterEach` helper is inlined.

Skipped, with reasons:
- Make a gone session key a server answer instead of navigating first: this is outside the diff, and the
  ordering is covered by e2e.
- An optimistic cache write in place of local `picked`: `onMutate` runs a tick late, so it would hit the same race.
- Fold the per-mutate callbacks back into the component: that would bring back the round-1 bug.
- Drop the `account` flag from `timed`, or pass the account to remarks directly: both are plan decisions.
- Move `latestNames` into `ids.list()`: the plan keeps `ids.ts` on `my_ids` only.
- Structured remarks keys, and a view-state namespace for header settings: YAGNI with one header setting.
- A shared `save_failed` warn helper: each call site writes its own one-liner, which is the app's idiom.
- `redirect()` from `redirect.tsx`: it skips when the URL has moved, the opposite of what's wanted here.

After `/simplify`: `bun run check` passed 1958 tests. The first run hit the `tray.test.ts` timing flake that
BACKLOG already lists; the rerun was clean. `bun run e2e accounts settings-tables recap-guess shell` passed 29 of 29.

### Round 2 (delta `git diff e5e0eba`)

Passes: `correctness-reviewer`, `arch-reviewer` (sonnet), `security-reviewer`. `recorder.ts` and `log.ts` sit
outside the round-1 diff. Their change is a mechanical helper extraction, so it was reviewed as part of this delta
(correctness checked that it preserves behaviour) rather than in a full round with `/code-review`.

- correctness: `useSaveAccount` compares the cached account with the resolved `picker.value`. When the stored
  account has fallen back (a stale id shows All), a failed pick refreshes the pages for nothing.
  [Verified, no fix needed] It's a harmless extra refetch, in a rare state.
- arch: no blank line before `export type Ids` in `ids.ts`. [Fixed]
- arch: the `main.ts` comment doesn't say why the stores are shared. [Fixed] Reworded.
- security: no findings.
- Every round-1 [Fixed] entry was confirmed closed, with no regressions.

Done: round 2 found no new issue other than nits (comment fixes only), so the review is closed.
Review: code-review high, arch (opus, then sonnet), security, simplify; 2 rounds, 12 fixed, 1 deferred, 1 no fix needed.

