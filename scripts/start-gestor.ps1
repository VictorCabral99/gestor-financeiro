# Gestor Financeiro — sobe serviços, abre janela app e encerra tudo ao fechar a janela
$ErrorActionPreference = "Stop"

$proj = Split-Path -Parent $PSScriptRoot
if (-not $proj) { $proj = "C:\Projetos\gestor-financeiro" }

# Portas dedicadas do atalho (evita abrir outro Vite/API que já esteja em 5173/3333)
$UiPort = 5473
$ApiPort = 3433
# 127.0.0.1 (não localhost): no Windows o Vite e o Brave discordam IPv4/IPv6
$Url = "http://127.0.0.1:$UiPort"
$Api = "http://127.0.0.1:$ApiPort/api/health"
$LogPath = Join-Path $env:TEMP "gestor-financeiro-launcher.log"
# Chromium com --app (Chrome/Brave). Edge por último: o processo inicial
# costuma encerrar na hora e o -Wait antigo matava API/UI com a janela ainda aberta.
$BrowserCandidates = @(
  @{ Name = "brave"; Exe = "brave.exe"; Path = "${env:ProgramFiles}\BraveSoftware\Brave-Browser\Application\brave.exe" }
  @{ Name = "brave"; Exe = "brave.exe"; Path = "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe" }
  @{ Name = "chrome"; Exe = "chrome.exe"; Path = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe" }
  @{ Name = "chrome"; Exe = "chrome.exe"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" }
  @{ Name = "edge"; Exe = "msedge.exe"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
  @{ Name = "edge"; Exe = "msedge.exe"; Path = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe" }
)

function Write-GestorLog([string]$msg) {
  try {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch {}
}

function Test-GestorApi([string]$u) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2
    return $r.Content -match 'gestor-financeiro'
  } catch {
    return $false
  }
}

function Test-GestorUi([string]$u) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2
    if ($r.Content -notmatch 'Gestor Financeiro') { return $false }
    # Confirma via proxy que a API atrás da UI é a nossa
    $h = Invoke-WebRequest -Uri ($u.TrimEnd('/') + "/api/health") -UseBasicParsing -TimeoutSec 2
    return $h.Content -match 'gestor-financeiro'
  } catch {
    return $false
  }
}

function Wait-GestorUi([string]$u, [int]$seconds = 45) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-GestorUi $u) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Stop-Tree([int]$processId) {
  if ($processId -le 0) { return }
  try {
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  } catch {}
}

function Get-GestorBrowser {
  foreach ($c in $BrowserCandidates) {
    if (Test-Path -LiteralPath $c.Path) { return $c }
  }
  return $null
}

function Get-ProfileProcesses([string]$exeName, [string]$profileDir) {
  $needle = $profileDir.ToLowerInvariant()
  $appNeedle = ("--app=" + $Url).ToLowerInvariant()
  try {
    $procs = Get-CimInstance Win32_Process -Filter ("Name='" + $exeName + "'") -ErrorAction Stop
  } catch {
    Write-GestorLog ("Get-CimInstance failed: " + $_.Exception.Message)
    return @()
  }
  @($procs | Where-Object {
    if (-not $_.CommandLine) { return $false }
    $cmd = $_.CommandLine.ToLowerInvariant()
    return ($cmd.Contains($needle) -or $cmd.Contains($appNeedle))
  })
}

function Clear-StaleBrowserProfile([string]$profileDir) {
  if (-not (Test-Path -LiteralPath $profileDir)) { return }
  foreach ($name in @("SingletonLock", "SingletonCookie", "lockfile", "SingletonSocket")) {
    $p = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
      Write-GestorLog ("removed stale " + $name)
    }
  }
  # Cache de GPU de versao anterior do navegador deixa a janela --app em branco
  foreach ($name in @("GPUCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "GPUPersistentCache",
      "Default\GPUCache", "Default\DawnGraphiteCache", "Default\DawnWebGPUCache")) {
    $p = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-StaleProfileBrowsers([string]$exeName, [string]$profileDir) {
  $existing = Get-ProfileProcesses $exeName $profileDir
  foreach ($p in $existing) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      Write-GestorLog ("killed stale browser pid=" + $p.ProcessId)
    } catch {}
  }
  if ($existing.Count -gt 0) { Start-Sleep -Seconds 1 }
}

function Wait-BrowserProfile([string]$exeName, [string]$profileDir, [int]$appearSeconds = 45) {
  $appeared = $false
  for ($i = 0; $i -lt $appearSeconds; $i++) {
    $found = @(Get-ProfileProcesses $exeName $profileDir)
    if ($found.Count -gt 0) {
      $appeared = $true
      Write-GestorLog ("browser appeared pid=" + $found[0].ProcessId)
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $appeared) {
    Write-GestorLog "browser did not appear; keeping services up and opening URL fallback"
    try { Start-Process $Url } catch {}
    # Sem processo de app controlado: não derruba API/UI no finally
    return $false
  }

  while (@(Get-ProfileProcesses $exeName $profileDir).Count -gt 0) {
    Start-Sleep -Seconds 1
  }
  Write-GestorLog "browser profile exited"
  return $true
}

Set-Location $proj
Write-GestorLog "launcher start proj=$proj"

# Filhos herdam estas variáveis (API e Vite do atalho).
# Se existir server/data/bridge.json, a API local envia e busca mudanças na conta.
$env:PORT = "$ApiPort"
$env:HOST = "127.0.0.1"
$env:GESTOR_API_ORIGIN = "http://127.0.0.1:$ApiPort"
$env:GESTOR_UI_PORT = "$UiPort"

$startedServer = $false
$startedClient = $false
$serverProc = $null
$clientProc = $null
$shouldStopServices = $true

try {
  if (-not (Test-GestorApi $Api)) {
    $serverProc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c `"$PSScriptRoot\run-api.cmd`"" `
      -WorkingDirectory $proj `
      -WindowStyle Minimized `
      -PassThru
    $startedServer = $true
    Write-GestorLog ("started api pid=" + $serverProc.Id)
  } else {
    Write-GestorLog "api already up"
  }

  if (-not (Test-GestorUi $Url)) {
    $clientProc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c `"$PSScriptRoot\run-ui.cmd`"" `
      -WorkingDirectory $proj `
      -WindowStyle Minimized `
      -PassThru
    $startedClient = $true
    Write-GestorLog ("started ui pid=" + $clientProc.Id)
  } else {
    Write-GestorLog "ui already up"
  }

  if (-not (Wait-GestorUi $Url 60)) {
    Write-GestorLog "ui health timeout after 60s - opening anyway"
  } else {
    Write-GestorLog "ui healthy"
  }

  $chosen = Get-GestorBrowser
  if ($null -eq $chosen) {
    Start-Process $Url
    Write-GestorLog "no chromium browser found; opened default handler"
    $shouldStopServices = $false
    return
  }

  $ProfileDir = Join-Path $env:TEMP ("gestor-financeiro-" + $chosen.Name + "-profile")
  Stop-StaleProfileBrowsers $chosen.Exe $ProfileDir
  Clear-StaleBrowserProfile $ProfileDir

  $browserArgs = @(
    "--user-data-dir=$ProfileDir"
    "--no-first-run"
    "--no-default-browser-check"
    "--app=$Url"
  )
  if ($chosen.Name -eq "edge") {
    $browserArgs += "--disable-features=msStartupBoost,msEdgeSidebar"
  }

  Write-GestorLog ("launching " + $chosen.Name + " app=" + $Url)
  Start-Process -FilePath $chosen.Path -ArgumentList $browserArgs | Out-Null
  # Nao usar -Wait: no Edge o processo inicial sai na hora e o finally
  # derrubava a API/UI. Espera os processos deste perfil isolado.
  $controlled = Wait-BrowserProfile $chosen.Exe $ProfileDir
  if (-not $controlled) {
    $shouldStopServices = $false
  }

} catch {
  Write-GestorLog ("launcher error: " + $_.Exception.Message)
  throw
} finally {
  if ($shouldStopServices) {
    # So mata o que ESTE launcher subiu (nao processos que ja estavam rodando)
    if ($startedClient -and $clientProc) {
      Stop-Tree $clientProc.Id
      Write-GestorLog ("stopped ui tree pid=" + $clientProc.Id)
    }
    if ($startedServer -and $serverProc) {
      Stop-Tree $serverProc.Id
      Write-GestorLog ("stopped api tree pid=" + $serverProc.Id)
    }
  } else {
    Write-GestorLog "leaving services running (uncontrolled browser session)"
  }
  Write-GestorLog "launcher end"
}
