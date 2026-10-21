' Launcher silencioso: sobe o Gestor, abre janela app e fecha os servicos ao sair
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.GetParentFolderName(WScript.ScriptFullName) & "\start-gestor.ps1"
' 0 = janela oculta; True = espera o PowerShell terminar (servicos sobem/descem junto)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, True
