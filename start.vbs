' Desktop usage board - silent launcher (no console window)
Option Explicit
Dim fso, sh, base, exe, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exe = base & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron runtime not found." & vbCrLf & vbCrLf & "Please run: pnpm install", vbExclamation, "Desktop Board"
  WScript.Quit 1
End If
sh.CurrentDirectory = base
cmd = "cmd /c set ""ELECTRON_RUN_AS_NODE="" & start """" """ & exe & """ ."
sh.Run cmd, 0, False
