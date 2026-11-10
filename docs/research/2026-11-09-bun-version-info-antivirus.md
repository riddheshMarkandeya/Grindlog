# Bun-compiled exe version info and antivirus (research, 2026-11-09)

## Summary table

| PE version field | Bun default | Overwritten by | Left "bun" after all flags |
|---|---|---|---|
| FileDescription | "Bun" | `--windows-description` | no |
| ProductName | "Bun" | `--windows-title` | no |
| CompanyName | "Oven" | `--windows-publisher` | no |
| LegalCopyright | "https://bun.com/docs/project/licensing" | `--windows-copyright` | no |
| FileVersion, ProductVersion (string and numeric) | the Bun release | `--windows-version` | no |
| OriginalFilename | "bun.exe" | blanked to "" automatically whenever any Windows flag is used | no (empty) |
| InternalName | "bun" | nothing | **yes** |
| Icon | Bun icon | `--windows-icon` | no |

## What the sources say

**Defaults.** The version resource in the Bun binary is declared as FileDescription "Bun", InternalName "bun", OriginalFilename "bun.exe", ProductName "Bun", CompanyName "Oven", LegalCopyright "https://bun.com/docs/project/licensing", FileVersion and ProductVersion from the Bun version. https://github.com/oven-sh/bun/blob/main/src/windows-app-info.rc
A compiled exe built with no flags shows ProductName Bun, FileDescription Bun, CompanyName Oven, OriginalFilename bun.exe (opencode, built with Bun 1.3.10). https://github.com/anomalyco/opencode/issues/15880

**What the flags write.** `compile` options and CLI flags: `icon`, `hideConsole`, `title`, `publisher`, `version`, `description`, `copyright`. Not usable when cross-compiling, except `hideConsole`. Docs: https://bun.com/docs/compiler/executables.md (section "Windows-specific flags"; `bun.com/docs/bundler/executables` now 404s).
The code: `rescle__setWindowsMetadata` sets title -> ProductName, publisher -> CompanyName, description -> FileDescription, copyright -> LegalCopyright; version is parsed as up to four numbers and sets the numeric FileVersion and ProductVersion plus both strings as "a.b.c.d"; then it always sets OriginalFilename to "". No call touches InternalName. https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/windows/rescle-binding.cpp (lines 17-100)
The metadata step runs only if at least one of icon/title/publisher/version/description/copyright is given. `hideConsole` alone does not trigger it. https://github.com/oven-sh/bun/blob/main/src/standalone_graph/StandaloneModuleGraph.rs (around line 3370)
An empty or missing flag leaves that field at the "Bun" default (each field is set only `if (value && *value)`, same file as above).

**Versions (inferred from PR merge dates against the release list; the PRs do not state release numbers).**
- `--windows-icon`, `--windows-hide-console` (originally `--windows-no-console`): PR #15894, merged 2024-12-20. https://github.com/oven-sh/bun/pull/15894
- `--windows-title/publisher/version/description/copyright`: PR #22067, merged 2025-08-23; first release dated after is v1.2.21 (2025-08-25). https://github.com/oven-sh/bun/pull/22067
- OriginalFilename cleared automatically: PR #22389, merged 2025-09-04; first later release v1.2.22 (2025-09-14). https://github.com/oven-sh/bun/pull/22389
- `--windows-hide-console` actually sets the PE GUI subsystem: PR #36292, merged 2026-07-29 (release not determined). https://github.com/oven-sh/bun/pull/36292
- Bun 1.4.3 (the project's version) is later than all of these. The `Bun.build` `compile.windows` object is in the 1.4.x docs and type reference (https://bun.com/docs/compiler/executables.md, lines 1371-1379).

**Payload layout.** Bun stores the embedded bundle in a `.bun` PE section (`add_bun_section`), and strips any Authenticode signature when it does so. https://github.com/oven-sh/bun/blob/main/src/standalone_graph/StandaloneModuleGraph.rs (lines 2646-2663). Before PR #21091 (merged 2025-07-16) the payload was appended after the PE image, and `--windows-icon` (via `UpdateResource`) dropped it, producing an exe that behaved like plain `bun`. Maintainer-bot reply: #21091 "moved the embedded bundle into a proper `.bun` PE section, which Windows resource editing preserves", confirmed by users on 1.2.22 and 1.3.14. https://github.com/oven-sh/bun/issues/17262 ; https://github.com/oven-sh/bun/pull/21091
In the same issue, a user reported that electron/rcedit caused the same crash back when the payload was appended (a struck-through workaround). Nobody in the thread reports rcedit against the current layout.

**rcedit.** CLI supports `--set-version-string <property> <value>` for any version-string property, `--set-file-version`, `--set-product-version`, `--set-icon`. https://github.com/electron/rcedit (README lines 32-85). Bun's own metadata code is built on a vendored `rescle` `ResourceUpdater` (`rescle.h`/`rescle.cpp` in `src/jsc/bindings/windows/`) and rcedit is a thin CLI over the same library family, so both edit via the Win32 resource API.

**Antivirus and SmartScreen.**
- SmartScreen's stated inputs are publisher reputation (is it signed, by a known certificate) and file hash reputation (has this exact file been downloaded without signs of malice). Unsigned files "must build for each new version"; the prompt stops "once the file hash has sufficient download history... several weeks and hundreds of clean installs". The page says nothing about version-info fields or file names. https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Microsoft's classification page describes behavior categories (Downloader: "downloads other malware onto your device"; Trojan: "attempts to appear harmless... tries to look legitimate"; unwanted software: installs or removes software "without your permission, interaction, or consent"; PUA "Evasion software", "Poor industry reputation": other trusted vendors detect it). It lists no metadata or version-info criterion. Unknown software gets "early warning" prompts, "not blocks". https://learn.microsoft.com/en-us/defender-xdr/criteria
- False-positive route: submit the file at https://www.microsoft.com/wdsi/filesubmission as a software developer (sign-in required; email not accepted), wait for a final determination, then use the developer contact form on the result if disputing. Authenticated and enterprise submissions are prioritized; "prevalent files" first. Submissions "start establishing reputation". Rescan from the submission details page. https://learn.microsoft.com/en-us/defender-xdr/submission-guide
- Bun's own Windows binary was flagged by Defender as `Trojan:Script/Wacatac.B!ml` (1.1.43, Jan 2025) and again `Wacatac.H!ml` (1.3.9, Feb 2026, via scoop). Jarred Sumner: "Sounds like we need to start codesigning the Windows executable"; one user later reports it "working OK" again without a stated fix. https://github.com/oven-sh/bun/issues/16284 ; https://github.com/oven-sh/bun/issues/26820
- Searching `oven-sh/bun` issues for SmartScreen returned nothing. No Bun issue ties a detection of a user-compiled exe to its version-info fields (searches: compile+defender, compile+antivirus, compile+virus, Wacatac, smartscreen, rcedit).

## Own inferences (not stated by a source)

- After setting all flags, only InternalName stays "bun". The two flags that matter for "not a stock Bun exe" (ProductName, CompanyName, FileDescription) are covered; InternalName is rarely shown in UI (Explorer's Details tab shows FileDescription, ProductName, Copyright, original filename, file version; InternalName is not shown there, to my knowledge; not verified here).
- A post-build `rcedit grindlog.exe --set-version-string InternalName grindlog` is the plainest fix and should preserve the `.bun` section, because that section now survives `UpdateResource` (the same API Bun's own flags use). Not tested. Do it before any signing step, and test the result by running the exe (it must run your app, not print Bun's help).
- Mismatched or generic version info as an AV trigger: no first-party source supports it. Microsoft's published signals are reputation (hash and signing), behavior, and other vendors' verdicts. A "bun"/"Oven" identity on grindlog.exe would at most be a weak heuristic input for third-party engines; I found nothing that says so.
- What likely drives detections for an unsigned exe that downloads and runs an installer: ML heuristics on new unsigned binaries (the `!ml` suffix in Bun's own detections means a machine-learning verdict), the downloader-plus-execute behavior pattern, and zero reputation. The signature verification (minisign) and /VERYSILENT are not visible to a scanner as trust signals. Your own consented updater should not match the "unwanted software" definitions, but classification of behavior is Microsoft's call.
- Setting honest metadata (title, publisher, description, copyright, version) is cheap and consistent with Microsoft's "Trojan tries to look legitimate" framing only in the sense that real identity is expected; it will not replace signing or reputation.

## Open questions

- Exact Bun release numbers for PR #22067, #22389, #36292: not read from release notes (release bodies searched without a hit). Check `bun --version` that first accepts `--windows-title`, or the tag containing the commit.
- Whether rcedit (rather than Bun's vendored rescle) leaves the `.bun` section and Bun's runtime detection intact on a 1.4.3 output: untested. Test once in CI by running the edited exe.
- Whether `Bun.build` and the CLI compile paths in 1.4.3 behave identically for the metadata step (the CLI path was read on `main`, which is already past 1.4.3; 1.4.4 is the latest release).
- Whether any engine (Defender or third party) weighs version-info fields: no source. Only a VirusTotal run of the actual build, before and after setting fields, would answer it for this binary.
- Whether Windows Explorer or Task Manager display InternalName: not verified.
