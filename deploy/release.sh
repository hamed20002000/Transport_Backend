#!/usr/bin/env bash
# Builds the three images on this (dev) machine from the sources in deploy/.env (TRANSPORT_SRC, TARABARI_SRC,
# FRONT_SRC), tagged with a version (date + commit) and as :latest. Then: docker compose up -d here to test it, and
# ./ship.sh to send that very version to the server.
#   ./release.sh                     all three
#   ./release.sh transport           only the ones that changed; the others' :latest get this version too
# Builds use the host network: a container network behind this machine's VPN (MTU 1420) hangs on large downloads.
set -euo pipefail
cd "$(dirname "$0")"

config=$(docker compose config --format json)
field() { python3 -c "import json,sys; c=json.load(sys.stdin)['services']['$1']['build']; print($2)" <<<"$config"; }

commit=$(git -C "$(field transport "c['context']")" rev-parse --short HEAD)
TAG="$(date +%Y%m%d-%H%M)-$commit"

build=("${@:-transport tarabari web}")
[ $# -eq 0 ] && build=(transport tarabari web)
for service in transport tarabari web; do
  if [[ ! " ${build[*]} " =~ " $service " ]]; then
    docker tag "trabot/$service:latest" "trabot/$service:$TAG"
    echo "== $service: unchanged, :latest is $TAG too"
    continue
  fi
  context=$(field "$service" "c['context']")
  if [ -n "$(git -C "$context" status --porcelain 2>/dev/null)" ]; then
    echo "note: $context has uncommitted changes; they go into this image too" >&2
  fi
  args=()
  while IFS= read -r arg; do [ -n "$arg" ] && args+=(--build-arg "$arg"); done < <(field "$service" "'\n'.join(f'{k}={v}' for k, v in (c.get('args') or {}).items())")
  echo "== $service ($context)"
  docker build --network host "${args[@]}" --label "trabot.tag=$TAG" \
    -t "trabot/$service:$TAG" -t "trabot/$service:latest" "$context"
done

echo
echo "built: TAG=$TAG"
echo "test here:   docker compose up -d"
echo "send it:     ./ship.sh user@server $TAG"
