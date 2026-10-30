#!/usr/bin/env bash
# Sends a version built by ./release.sh to the server and runs it there:
#   1. copies this folder's files (never .env, config/, data/ or the VPN configs: those live on the server only);
#   2. pushes the three images to the server's own registry through an SSH tunnel: only the layers that changed;
#   3. on the server: TAG in its deploy/.env, pull, migrations, up.
#   ./ship.sh user@server [TAG]        (TAG: the last ./release.sh by default)
# SERVER_DIR: the deploy folder on the server (default /opt/trabot/deploy).
set -euo pipefail
cd "$(dirname "$0")"

SERVER=${1:?usage: ./ship.sh user@server [TAG]}
TAG=${2:-$(docker image inspect trabot/transport:latest --format '{{index .Config.Labels "trabot.tag"}}')}
SERVER_DIR=${SERVER_DIR:-/opt/trabot/deploy}
LOCAL_PORT=${LOCAL_PORT:-5055}
for service in transport tarabari web; do
  docker image inspect "trabot/$service:$TAG" >/dev/null || { echo "no image trabot/$service:$TAG; run ./release.sh" >&2; exit 1; }
done
echo "version $TAG → $SERVER:$SERVER_DIR"

echo "1/3 files"
ssh "$SERVER" "mkdir -p '$SERVER_DIR'"
rsync -a --exclude .env --exclude 'config/' --exclude 'data/' --exclude 'vpn/wireguard/*.conf' \
  --exclude 'vpn/openvpn/*.ovpn' --exclude 'vpn/openvpn/*.key' --exclude 'vpn/openvpn/*.crt' ./ "$SERVER:$SERVER_DIR/"

echo "2/3 images"
ssh "$SERVER" "cd '$SERVER_DIR' && docker compose --profile registry up -d registry"
socket=$(mktemp -u)
ssh -o ExitOnForwardFailure=yes -f -N -M -S "$socket" -L "$LOCAL_PORT:127.0.0.1:5000" "$SERVER"
trap 'ssh -S "$socket" -O exit "$SERVER" 2>/dev/null || true' EXIT
for service in transport tarabari web; do
  docker tag "trabot/$service:$TAG" "localhost:$LOCAL_PORT/trabot/$service:$TAG"
  docker push "localhost:$LOCAL_PORT/trabot/$service:$TAG"
  docker rmi "localhost:$LOCAL_PORT/trabot/$service:$TAG" >/dev/null
done

echo "3/3 run"
ssh "$SERVER" "cd '$SERVER_DIR' && sed -i -E 's/^TAG=.*/TAG=$TAG/' .env \
  && docker compose pull transport tarabari web \
  && docker compose up -d \
  && docker compose exec -T transport npm run typeorm -- migration:run \
  && docker compose exec -T tarabari npm run typeorm -- migration:run \
  && docker compose ps"
echo "done: $SERVER runs $TAG (back to an older one: ./ship.sh $SERVER <older TAG>)"
