@echo off
title Gestor Financeiro — API
cd /d "%~dp0.."
npm --prefix server run dev
