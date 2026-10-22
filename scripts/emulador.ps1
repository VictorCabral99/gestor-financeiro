# Abre o Android emulado "gestor", liga a porta da API local e instala o APK atual.
$ErrorActionPreference = 'Stop'
$sdk = 'C:\Projetos\anime-downloader\tools\android-sdk'
$root = Split-Path -Parent $PSScriptRoot
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) { $adb = 'adb' }

function Emulator-Online {
  $lines = & $adb devices
  return [bool]($lines | Select-String 'emulator-\d+\s+device')
}

if (-not (Emulator-Online)) {
  Start-Process -FilePath (Join-Path $sdk 'emulator\emulator.exe') -ArgumentList @(
    '-avd', 'gestor', '-netdelay', 'none', '-netspeed', 'full', '-scale', '0.42', '-no-boot-anim'
  )
  & $adb wait-for-device | Out-Null
  do {
    Start-Sleep -Seconds 2
    $boot = (& $adb shell getprop sys.boot_completed).Trim()
  } while ($boot -ne '1')
}

& $adb reverse tcp:3433 tcp:3433 | Out-Null

# Gaveta só com o essencial. O que for instalado por aqui (adb/APK) permanece.
$tirar = @(
  'com.android.camera2',
  'com.android.chrome',
  'com.android.stk',
  'com.google.android.apps.docs',
  'com.google.android.apps.maps',
  'com.google.android.apps.messaging',
  'com.google.android.apps.photos',
  'com.google.android.apps.safetyhub',
  'com.google.android.apps.youtube.music',
  'com.google.android.calendar',
  'com.google.android.contacts',
  'com.google.android.deskclock',
  'com.google.android.dialer',
  'com.google.android.gm',
  'com.google.android.googlequicksearchbox',
  'com.google.android.youtube'
)
foreach ($pkg in $tirar) {
  & $adb shell pm uninstall --user 0 $pkg | Out-Null
}

$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
if (Test-Path $apk) {
  & $adb install -r $apk | Out-Null
}
& $adb shell am start -n com.victor.gestor/.MainActivity | Out-Null
Write-Host 'Gestor Financeiro aberto no Android emulado.'
