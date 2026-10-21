# Publica a versão do version.json nas releases do próprio repositório do gestor.
# O celular consulta essas releases, baixa o APK e instala. Não há repositório apartado.
param([Parameter(Mandatory = $true)][string]$Notas)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repo = 'VictorCabral99/gestor-financeiro'
$jdkCandidates = @(
  (Join-Path $root 'tools\jdk\jdk-21.0.12.1+1'),
  'C:\Projetos\anime-downloader\tools\jdk\jdk-21.0.12.1+1'
)
foreach ($jdk in $jdkCandidates) {
  if (Test-Path $jdk) { $env:JAVA_HOME = $jdk; break }
}

$meta = Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json
$version = [string]$meta.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "version.json está com a versão '$version'. Use número.número.número." }

Write-Host "Versão $version"
Write-Host "O celular recebe este APK pelas releases de $repo."

gh repo view $repo --json name,isPrivate 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "O repositório $repo ainda não existe. As versões saem nele, no mesmo lugar do gestor."
}
$private = gh repo view $repo --json isPrivate --jq .isPrivate
if ($private -eq 'true') {
  throw "O celular consulta as versões sem login. $repo precisa ser público para o aplicativo baixar a atualização."
}

$preferencia = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
gh release view "v$version" --repo $repo 2>$null | Out-Null
$jaPublicada = $LASTEXITCODE -eq 0
$ErrorActionPreference = $preferencia
if ($jaPublicada) { throw "A versão $version já foi publicada. Aumente version e code em version.json." }

Write-Host 'Gerando o APK...'
Push-Location (Join-Path $root 'android')
try {
  & .\gradlew.bat :app:assembleRelease
  if ($LASTEXITCODE -ne 0) { throw 'O build do APK falhou.' }
} finally {
  Pop-Location
}

$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "Não achei o APK em $apk." }
$named = Join-Path $env:TEMP 'Gestor.apk'
Copy-Item $apk $named -Force

gh release create "v$version" $named --repo $repo --title "Gestor $version" --notes $Notas
if ($LASTEXITCODE -ne 0) { throw 'Não deu para publicar a versão.' }
Write-Host "Publicado: https://github.com/$repo/releases/tag/v$version"
