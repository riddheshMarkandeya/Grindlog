# Tray technology for Grindlog (research, 2026-11-06)

Source tags: **[S]** = stated by the cited primary source; **[I]** = my inference; **[?]** = not verified this session.
Limits: no memory was measured by me. No first-party antivirus evidence found for any option. Bun's compile docs, Tauri, Electrobun, Go/Rust binary sizes and the Windows runner image contents were NOT read (fetch 404 or out of budget).

## Comparison

| Option | Runtime on friend's PC | Exe size | Idle memory | Notifications | Windows-runner build | AV reputation (unsigned) | Licence | TS-dev burden |
|---|---|---|---|---|---|---|---|---|
| A. bun:ffi + Shell_NotifyIcon in existing exe | none (already bundled) | +0 | unknown; adds a message-loop thread to a Bun process [I] | Possible via NIF_INFO [S, Win32] but you hand-write structs | already builds | no new binary, so no new surface [I] | n/a | low language, high Win32 knowledge; but bun:ffi "experimental ... Do not rely on it in production" [S] |
| B1. Rust `tray-icon` | none [I] | unknown [?] | unknown | README does not mention notifications; needs a separate crate or hand-rolled NIF_INFO [S: silence; I] | yes (cargo) [I] | no first-party evidence | Apache-2.0 / MIT [S] | high: new language and toolchain |
| B2. Go `getlantern/systray` | none [I] | unknown [?] | unknown | README does not mention notifications [S: silence] | needs `CGO_ENABLED=1` and a C compiler [S] | no first-party evidence | Apache-2.0 [S] | high: new language |
| B3. Plain C/C++ Win32 | none | very small [I] | very small [I] | NIF_INFO direct [S, Win32] | MSVC on runner [I] | no first-party evidence | n/a | highest: C Win32 |
| C1. .NET self-contained single-file WinForms | none, but the runtime is bundled | large (full runtime; trimming of WinForms not verified) [I][?] | unknown | `NotifyIcon` (+ balloon tip) [S: NotifyIcon exists; balloon API from my knowledge, [?]] | `dotnet publish` [S] | no first-party evidence | .NET is MIT [?] | medium: C# is close to TS |
| C2. .NET NativeAOT WinForms | none | small [S: AOT apps have "smaller memory footprints"] | lower than C1 [S, general claim] | n/a | n/a | n/a | n/a | **Not viable**: no official support; blocked by COM reliance [S, issue #4940] |
| C3. .NET Framework 4.8 NotifyIcon, compiled with OS `csc.exe` | none: 4.8 is preinstalled on Win 10 1903+ and Win 11 [S] | tens of KB [I] | unknown (CLR plus WinForms load, likely tens of MB) [I] | `NotifyIcon` + balloon tip (OS toast on 10/11) [I][?] | csc.exe ships in the OS .NET Framework folder [?]; MSBuild/`dotnet build` targeting net48 also works [I] | no first-party evidence | OS component | medium: C# 5-era compiler by default [?] |
| D. PowerShell + NotifyIcon | Windows PowerShell 5.1 preinstalled [I] | script | powershell.exe is heavy (tens of MB) [I] | `NotifyIcon` balloon [I] | trivial | scripts are the usual AV heuristic target [I] | n/a | low language, but policy friction (below) |
| E. Tauri / Electrobun | WebView2 [?] | n/a | n/a | n/a | n/a | n/a | n/a | **Ruled out [I]**: a webview stack for a 4-item menu contradicts the 100 MB goal and adds a toolchain; the dashboard is already a web page |

## Recommendation

1. **Preferred: C3, a .NET Framework 4.8 WinForms `NotifyIcon` exe** (about 100 lines of C#), built on the runner. It needs nothing installed on friends' PCs, and 4.8 ships with Windows 10 1903+ and Windows 11 [S]. **Caveat:** Windows 10 versions before 1903 only get 4.8 by install (listed as "not preinstalled" in the same table) [S]. If any friend is on 1809 or older, this fails.
2. **Fallback: a tiny Rust or C Win32 exe** if C3 measures over budget or the runner lacks what's needed. This costs a second language.
3. **Reject:** NativeAOT WinForms (unsupported), PowerShell (policy and AV friction), Tauri/Electrobun, and bun:ffi (officially experimental).

Do this before deciding: build the 100-line C3 exe and measure its working set on a Win 10 and a Win 11 box. No source I read gives a figure.

## Process-model implications

- The tray is a separate small exe in every viable option. A tray cannot be "one exe with the tracker" except via bun:ffi (option A), which Bun says not to rely on in production [S].
- Whether the tray replaces the supervisor: a .NET tray can start and stop the tracker with `Process.Start` and poll HTTP, so it can be the supervisor, with the tray as the parent that owns "stop" [I]. That makes two exes: tray/supervisor plus tracker. The cost is that a tray crash then also stops supervision; a tracker-side supervisor avoids that [I].
- Starting at logon: a Run registry key or Startup shortcut works for any exe [I, not sourced]. PowerShell would need a policy-proof launcher [see below].

## Evidence by claim

**A. bun:ffi**
- "`bun:ffi` is **experimental**, with known bugs and limitations. Do not rely on it in production." [S] https://bun.com/docs/runtime/ffi
- HANDLE is not a virtual address; use `u64`, not `ptr` [S] https://bun.com/docs/runtime/ffi
- Thread-safe `JSCallback` is experimental and the callback runs on the JS thread; C side must treat it as returning `void` [S] https://bun.com/docs/runtime/ffi. A window procedure needs a return value (LRESULT) and runs on the thread that owns the window [I, Win32 knowledge], so a WndProc in JS is fragile.
- The FFI page says nothing about compiled executables [S: silence]. Whether `bun build --compile` embeds and runs ffi code correctly is **unsettled** (the executables doc returned 404).

**Shell_NotifyIcon** (applies to all native options)
- Adds, modifies and deletes status-area icons; icon identity by `uID` or `guidItem`; NIM_SETVERSION must be called on every add [S] https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyicona
- Balloon needs `NIF_INFO` with `szInfo`/`szInfoTitle`; callbacks (`NIN_BALLOONUSERCLICK` etc.) arrive as the lParam of the app-defined callback message [S] same URL (plus the NOTIFYICONDATA page, not read).
- A message-receiving window (and so a message loop) is required [I, Win32 knowledge; the page does not state it].

**B. Native**
- `tray-icon`: licence Apache-2.0/MIT; "On Windows ... an event loop must be running on the thread"; no mention of notifications [S] https://github.com/tauri-apps/tray-icon
- A third-party crate worked around ID clashes with `tray-icon`'s internal icon ID to add balloons [S, secondhand] https://docs.rs/crate/freecycle/latest/source/src/notifications.rs
- `getlantern/systray`: Apache-2.0; Windows, macOS, Linux; requires cgo; use `-ldflags -H=windowsgui` to avoid a console; no mention of notifications; no releases listed, maintenance status unknown [S] https://github.com/getlantern/systray

**C. .NET**
- NativeAOT: self-contained; "smaller memory footprints"; Windows build needs Visual Studio with the C++ workload; no dynamic loading; "Windows: No built-in COM" [S] https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/
- WinForms on NativeAOT: the Native AOT page does not list WinForms as supported [S: silence]. Maintainers said WinForms relies on COM in many ways and the tooling is missing [S, via search summary, issue not opened directly] https://github.com/dotnet/winforms/issues/4940. The epic for trimming is https://github.com/dotnet/winforms/issues/4649 (not opened). Conclusion: treat as unsupported [I].
- Single-file self-contained: includes the runtime and framework, so the file is large; native runtime libraries stay separate unless `IncludeNativeLibrariesForSelfExtract` is set, which then extracts to `%TEMP%/.net` [S] https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview
- .NET Framework 4.8 is preinstalled on Windows 10 1903, 1909, 2004, 20H2, 21H1, 21H2, 22H2 and Windows 11; "➕" (installable, not preinstalled) on 1607 to 1809; .NET Framework "will continue to be included with Windows, with no plans to remove it" [S] https://learn.microsoft.com/en-us/dotnet/framework/migration-guide/versions-and-dependencies
- Windows 11 24H2/25H2 (build 26100 and 26200) ship 4.8.1; an app targeting 4.8 runs on 4.8.1 as 4.x versions are in-place updates [S] same URL
- `NotifyIcon` shows icons in the status area for background processes [S] https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/notifyicon-component-windows-forms. `ShowBalloonTip` and its Win 10/11 toast presentation are not stated on that page [?].
- The location of `csc.exe` (`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\`) and its presence on the `windows-latest` runner are **unverified here** [?].

**D. PowerShell**
- Default policy is RemoteSigned on Windows computers per one heading, but also "if ... all scopes are Undefined, effective policy is Restricted for Windows clients" (the page is internally inconsistent; Windows client default is stated as Restricted) [S] https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies
- Policy "isn't a security boundary"; Group Policy overrides all scopes; a launcher can pass `-ExecutionPolicy Bypass` per process [S] same URL. Downloaded unsigned scripts are blocked under RemoteSigned unless unblocked [S] same URL.
- A hidden-window PowerShell host staying resident for a tray is heavier than a native exe [I]; no figure measured.

## Open questions

1. Working set of each candidate at idle (none measured here). Cheapest check: build C3 and a Rust `tray-icon` hello world, read Task Manager working set.
2. Does `bun build --compile` run `bun:ffi` correctly on Windows? (Bun executables doc not retrieved.)
3. Which friends' Windows 10 builds are below 1903 (4.8 not preinstalled)?
4. Exact C# language level from the OS `csc.exe`, and whether the runner has it.
5. Antivirus: no first-party data on unsigned small .NET Framework, Rust, Go or Bun exes. Code signing is covered separately in `docs/research/2026-11-06-code-signing.md`.
6. Does `tray-icon` (or `muda`) expose balloon notifications, or is a raw `NIF_INFO` call needed?
7. Tauri and Electrobun: ruled out by inference only; their docs and measured memory were not read.
