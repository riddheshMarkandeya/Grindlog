; The friends release installer: a per-user, no-admin install of the prod build that
; scripts/build-release.ts stages in release\app. It runs by hand (a wizard) and silently from the
; updater, forward or as a rollback to an older version. Build it with `bun run build-release`, which
; passes every define below.

#ifndef AppVersion
  #error Build with bun run build-release, which defines AppVersion and the rest.
#endif

[Setup]
; Never change: Windows keys the install (and its uninstaller) on it.
AppId={{1B446AC6-B80A-4B80-B48D-CC19063AFDDD}
AppName=Grindlog
AppVersion={#AppVersion}
VersionInfoVersion={#AppNumericVersion}.0
; What sign-release checks against the tag, so it carries any -rc suffix.
VersionInfoProductTextVersion={#AppVersion}
AppPublisher=Grindlog
AppSupportURL=https://github.com/riddheshMarkandeya/RL-Tracker
; Per-user: {autopf} is %LOCALAPPDATA%\Programs, and no UAC prompt.
PrivilegesRequired=lowest
DefaultDirName={autopf}\Grindlog
DisableDirPage=yes
DisableProgramGroupPage=yes
; 1903, the first with .NET Framework 4.8, which the tray needs.
MinVersion=10.0.18362
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile={#SourcePath}..\src\web\public\favicon.ico
UninstallDisplayIcon={app}\{#ExeName}
UninstallDisplayName=Grindlog
WizardStyle=modern
OutputBaseFilename=Grindlog-Setup-{#AppVersion}
SolidCompression=yes
; In %TEMP% (or where the updater's /LOG= says), for "what did that install or uninstall do".
SetupLogging=yes
UninstallLogging=yes
; Restart Manager may close what --quit missed, but restarting is the updater's job, not its.
RestartApplications=no

[InstallDelete]
; A new dashboard build has new hashed asset names; the old ones would pile up.
Type: filesandordirs; Name: "{app}\web"

[Files]
; All ignoreversion: a rollback installs older exes, and an rc and its final share a file version.
Source: "{#SourceDir}\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\{#TrayExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs
; This installer itself, which the updater runs to roll back a bad update.
Source: "{srcexe}"; DestDir: "{localappdata}\{#DataDirName}\update\previous"; DestName: "Grindlog-Setup.exe"; Flags: external ignoreversion
; Filled in and registered by RegisterTask below; never installed.
Source: "{#SourceDir}\task.xml"; Flags: dontcopy

[Icons]
Name: "{userprograms}\{#ShortcutName}"; Filename: "{app}\{#ExeName}"; Parameters: "--open"; WorkingDir: "{app}"

[Run]
; Starts the app if it isn't running and opens the dashboard. Skipped when silent: the updater restarts it.
Filename: "{app}\{#ExeName}"; Parameters: "--open"; Flags: nowait skipifsilent

[UninstallRun]
; The task goes first, so nothing can start the app again once it's quit.
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""{#TaskName}"" /F"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteTask"
Filename: "{app}\{#ExeName}"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "QuitApp"

[Code]
function XmlEscape(S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '&', '&amp;', True);
  StringChangeEx(Result, '<', '&lt;', True);
  StringChangeEx(Result, '>', '&gt;', True);
  StringChangeEx(Result, '"', '&quot;', True);
end;

{ Ends the running app (supervisor, tracker, tray) so its exes can be replaced. On failure the install
  goes on: Restart Manager's CloseApplications is the backstop. The updater stops the app itself first. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Exe: String;
  ResultCode: Integer;
begin
  Result := '';
  Exe := ExpandConstant('{app}\{#ExeName}');
  if not FileExists(Exe) then
  begin
    Log('No installed ' + Exe + ', so nothing to quit.');
    exit;
  end;
  if Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log(Format('%s --quit exited %d.', [Exe, ResultCode]))
  else
    Log(Format('%s --quit could not start: %s', [Exe, SysErrorMessage(ResultCode)]));
end;

procedure TaskNotCreated(Reason: String);
begin
  Log('Logon task {#TaskName} not created: ' + Reason);
  if not WizardSilent then
    MsgBox('Grindlog could not set itself to start with Windows (' + Reason + ').' + #13#10#13#10 +
      'Open it from the Start menu instead; it still records while it runs.', mbInformation, MB_OK);
end;

{ Registers the logon task that starts the supervisor, unless one exists: a task the dashboard switched
  off stays off, and one left on stays on. Never aborts the install. }
procedure RegisterTask;
var
  SchTasks, Path, Text: String;
  Raw: AnsiString;
  Lines: TArrayOfString;
  ResultCode: Integer;
begin
  SchTasks := ExpandConstant('{sys}\schtasks.exe');
  if not Exec(SchTasks, '/Query /TN "{#TaskName}"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    TaskNotCreated('schtasks could not start: ' + SysErrorMessage(ResultCode));
    exit;
  end;
  if ResultCode = 0 then
  begin
    Log('Logon task {#TaskName} found; left as it is.');
    exit;
  end;
  Log(Format('Logon task {#TaskName} not found (schtasks /Query exited %d); creating it.', [ResultCode]));
  ExtractTemporaryFile('task.xml');
  if not LoadStringFromFile(ExpandConstant('{tmp}\task.xml'), Raw) then
  begin
    TaskNotCreated('task.xml could not be read');
    exit;
  end;
  { The template is ASCII; the filled-in values may not be, hence the UTF-8 save. }
  Text := String(Raw);
  StringChangeEx(Text, '@@USER@@', XmlEscape(GetEnv('USERDOMAIN') + '\' + GetUserNameString), True);
  StringChangeEx(Text, '@@EXE@@', XmlEscape(ExpandConstant('{app}\{#ExeName}')), True);
  StringChangeEx(Text, '@@WORKDIR@@', XmlEscape(ExpandConstant('{app}')), True);
  Path := ExpandConstant('{tmp}\grindlog-task.xml');
  SetArrayLength(Lines, 1);
  Lines[0] := Text;
  { No XML declaration, so schtasks reads it as UTF-8, which is how it's written. }
  if not SaveStringsToUTF8FileWithoutBOM(Path, Lines, False) then
  begin
    TaskNotCreated('the task definition could not be written');
    exit;
  end;
  if not Exec(SchTasks, '/Create /TN "{#TaskName}" /XML "' + Path + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    TaskNotCreated('schtasks could not start: ' + SysErrorMessage(ResultCode))
  else if ResultCode <> 0 then
    TaskNotCreated(Format('schtasks /Create exited %d', [ResultCode]))
  else
    Log('Logon task {#TaskName} created.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    Log('Installed Grindlog {#AppVersion}.');
    RegisterTask;
  end;
end;

{ The match history outlives an uninstall unless the user asks otherwise; a silent uninstall keeps it. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep <> usPostUninstall then
    exit;
  DataDir := ExpandConstant('{localappdata}\{#DataDirName}');
  if not DirExists(DataDir) then
  begin
    Log('No data in ' + DataDir + ' to keep or delete.');
    exit;
  end;
  if UninstallSilent then
  begin
    Log('Data kept in ' + DataDir + ' (silent uninstall).');
    exit;
  end;
  if MsgBox('Also delete your match history?' + #13#10#13#10 + 'It is in ' + DataDir + '.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then
  begin
    Log('Data kept in ' + DataDir + ' (the user chose No).');
    exit;
  end;
  if DelTree(DataDir, True, True, True) then
    Log('Deleted ' + DataDir + '.')
  else
  begin
    Log('Could not delete ' + DataDir + '.');
    MsgBox('Some of your match history could not be deleted. Delete this folder by hand:' + #13#10#13#10 + DataDir, mbError, MB_OK);
  end;
end;
