@echo off
title Gestor Financeiro — UI
cd /d "%~dp0.."
if "%GESTOR_UI_PORT%"=="" set GESTOR_UI_PORT=5173
if "%GESTOR_API_ORIGIN%"=="" set GESTOR_API_ORIGIN=http://127.0.0.1:3333
npm --prefix client run dev -- --host 127.0.0.1 --port %GESTOR_UI_PORT% --strictPort
