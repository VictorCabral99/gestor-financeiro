@echo off
REM Compat: redireciona para o launcher PowerShell (fecha servicos ao fechar o app)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-gestor.ps1"
