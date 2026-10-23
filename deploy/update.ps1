# Saved with a UTF-8 BOM: Windows PowerShell 5.1 reads a -File script without one in the ANSI code page, which breaks the
# Korean below.
# start-hazelle.bat runs this before every start: a newer release replaces node\ and app\, this file among them, and
# leaves data\ and the batch file as they are. Any failure starts the version in place.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot
Set-Location $root
$port = if ($env:PORT) { $env:PORT } else { '8080' }
$work = Join-Path $root 'update'

# A running one holds node.exe, which cannot be replaced; launch.js then opens it.
try { if ((Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return } } catch {}

try {
  $current = (Get-Content 'app\VERSION' -Raw).Trim()
  $latest = Invoke-RestMethod 'https://api.github.com/repos/jiniill/hazelle/releases/latest' -TimeoutSec 10
  if ([version]$latest.tag_name.TrimStart('v') -le [version]$current.TrimStart('v')) { return }
  $asset = $latest.assets | Where-Object name -eq 'hazelle-windows-x64.zip'
  Write-Host "새 버전을 받는 중이에요: $($latest.tag_name)"
  # Beside app\, not in %TEMP%: Move-Item cannot move a folder to another drive.
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory $work | Out-Null
  Invoke-WebRequest $asset.browser_download_url -OutFile "$work\hazelle.zip" -UseBasicParsing
  Expand-Archive "$work\hazelle.zip" $work
  $fresh = Join-Path $work 'hazelle'
  if (-not (Test-Path "$fresh\node\node.exe") -or -not (Test-Path "$fresh\app\dist\server\launch.js")) { throw 'the zip lacks node or app' }
  Remove-Item app.old, node.old -Recurse -Force -ErrorAction SilentlyContinue
  Rename-Item app app.old
  try {
    Rename-Item node node.old
    Move-Item "$fresh\app" app
    Move-Item "$fresh\node" node
  } catch {
    if (Test-Path node.old) {
      Remove-Item node -Recurse -Force -ErrorAction SilentlyContinue
      Rename-Item node.old node
    }
    Remove-Item app -Recurse -Force -ErrorAction SilentlyContinue
    Rename-Item app.old app
    throw
  }
  Remove-Item app.old, node.old -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "업데이트했어요: $current → $($latest.tag_name)"
} catch {
  Write-Host "업데이트하지 못해서 지금 버전으로 켜요. ($($_.Exception.Message))"
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
