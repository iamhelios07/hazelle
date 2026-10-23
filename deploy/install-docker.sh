#!/bin/sh
# Installs or updates the Docker self-host in ~/hazelle-docker (README "Self-hosting"), then opens it. A rerun pulls the
# newest image and the newest docker-compose.yml; the data volume stays.
#   curl -fsSL https://github.com/jiniill/hazelle/releases/latest/download/install-docker.sh | sh
set -eu
release=https://github.com/jiniill/hazelle/releases/latest/download
url=http://localhost:8080

# docker-compose.yml's !reset tags need Compose 2.24.
version=$(docker compose version --short 2>/dev/null || true)
major=$(echo "$version" | cut -d. -f1)
minor=$(echo "$version" | cut -d. -f2)
if [ -z "$version" ] || [ "$major" -lt 2 ] || { [ "$major" = 2 ] && [ "$minor" -lt 24 ]; }; then
  echo "Docker(Compose 2.24 이상)를 설치하고 켠 다음 다시 실행해 주세요: https://docs.docker.com/get-docker/" >&2
  exit 1
fi

mkdir -p "$HOME/hazelle-docker"
cd "$HOME/hazelle-docker"
curl -fsSLO "$release/docker-compose.yml"
docker compose pull app
docker compose up -d

tries=0
until curl -fs "$url/api/health" >/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "헤이젤이 1분 안에 켜지지 않았어요. 기록: cd ~/hazelle-docker && docker compose logs app" >&2
    exit 1
  fi
  sleep 1
done
echo "헤이젤이 켜졌어요: $url"
if command -v open >/dev/null; then open "$url"; elif command -v xdg-open >/dev/null; then xdg-open "$url"; fi
