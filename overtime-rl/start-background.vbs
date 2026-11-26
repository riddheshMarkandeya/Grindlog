Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = currentDir
' Launch Node server completely hidden in the background (window style 0)
WshShell.Run "node --experimental-strip-types src/server/main.ts", 0, False

' Open default web browser to OvertimeRL
WScript.Sleep 1000
WshShell.Run "http://localhost:49200", 1, False
