# Installs or updates the Docker self-host in %USERPROFILE%\hazelle-docker (deploy/install-docker.sh, for Windows), then
# opens it. A rerun pulls the newest image and the newest docker-compose.yml; the data volume stays.
# Windows PowerShell reads a downloaded script as ISO-8859-1, which breaks the Korean below, so it is run decoded:
#   iex ([Text.Encoding]::UTF8.GetString((iwr -useb https://github.com/jiniill/hazelle/releases/latest/download/install-docker.ps1).Content))
$ErrorActionPreference = 'Stop'
$release = 'https://github.com/jiniill/hazelle/releases/latest/download'
$url = 'http://localhost:8080'

# docker-compose.yml's !reset tags need Compose 2.24.
$version = try { (docker compose version --short 2>$null) -replace '^v', '' } catch { '' }
if (-not $version -or [version]($version -replace '[^0-9.].*$', '') -lt [version]'2.24') {
  Write-Host 'Docker Desktop(Compose 2.24 이상)을 설치하고 켠 다음 다시 실행해 주세요: https://docs.docker.com/desktop/setup/install/windows-install/'
  return
}

$folder = Join-Path $env:USERPROFILE 'hazelle-docker'
New-Item -ItemType Directory -Force $folder | Out-Null
Set-Location $folder
Invoke-WebRequest "$release/docker-compose.yml" -OutFile docker-compose.yml -UseBasicParsing
docker compose pull app
docker compose up -d

$deadline = (Get-Date).AddMinutes(1)
while ($true) {
  # 127.0.0.1: compose publishes no IPv6 port, and localhost tries ::1 first for longer than the timeout.
  try { if ((Invoke-WebRequest 'http://127.0.0.1:8080/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
  if ((Get-Date) -gt $deadline) {
    Write-Host "헤이젤이 1분 안에 켜지지 않았어요. 기록: cd $folder; docker compose logs app"
    return
  }
  Start-Sleep 1
}
Write-Host "헤이젤이 켜졌어요: $url"
Start-Process $url
