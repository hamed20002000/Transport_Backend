#!/usr/bin/env bash
# Sends the code you pushed to the server and runs it there (guide: deploy/SERVER-BUILD.md):
#   1. checks each project here: nothing tracked left uncommitted, the commit pushed to GitHub;
#   2. copies this folder's files (never .env, config/, data/ or the VPN configs: those live on the server only);
#   3. on the server: each project at exactly that commit (git, from GitHub), the images built there (its internet
#      reaches npm, Debian and Docker Hub fast; this machine's upload is slow), then TAG in its deploy/.env, up,
#      migrations.
#   ./ship.sh deploy@server              the commits checked out here now
#   ./ship.sh deploy@server <TAG>        back to a version the server built before (no build)
# SERVER_DIR: the deploy folder on the server (default /opt/trabot/deploy); the sources go beside it in ../src.
set -euo pipefail
cd "$(dirname "$0")"

SERVER=${1:?usage: ./ship.sh deploy@server [TAG]}
SERVER_DIR=${SERVER_DIR:-/opt/trabot/deploy}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519_vps}
ssh_() { ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SERVER" "$@"; }

# a version the server already built: switch to it, nothing to build
if [ -n "${2:-}" ]; then
  TAG=$2
  ssh_ "docker image inspect trabot/transport:$TAG trabot/tarabari:$TAG trabot/web:$TAG >/dev/null 2>&1" \
    || { echo "the server has no images of $TAG (docker images 'trabot/*' there lists them)" >&2; exit 1; }
  echo "back to $TAG on $SERVER"
  ssh_ "cd '$SERVER_DIR' && sed -i -E 's/^TAG=.*/TAG=$TAG/' .env && docker compose up -d && docker compose ps"
  exit
fi

config=$(docker compose config --format json 2>/dev/null)
context() { python3 -c "import json,sys; print(json.load(sys.stdin)['services']['$1']['build']['context'])" <<<"$config"; }

echo "1/3 the code here"
declare -A COMMIT URL
for service in transport tarabari web; do
  dir=$(context "$service")
  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    echo "  $dir has uncommitted changes: commit and push them first" >&2
    exit 1
  fi
  git -C "$dir" fetch --quiet origin
  if ! git -C "$dir" branch -r --contains HEAD | grep -q .; then
    echo "  $dir: commit $(git -C "$dir" rev-parse --short HEAD) is not on GitHub yet: git push" >&2
    exit 1
  fi
  COMMIT[$service]=$(git -C "$dir" rev-parse HEAD)
  # the address without any credentials in it
  URL[$service]=$(git -C "$dir" remote get-url origin | sed -E 's#https://[^@/]+@#https://#')
  echo "  $service: $(git -C "$dir" log -1 --format='%h %s' HEAD)"
done
TAG="$(date +%Y%m%d-%H%M)-${COMMIT[transport]:0:7}"
echo "version $TAG → $SERVER"

echo "2/3 files"
rsync -a -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes" \
  --exclude .env --exclude 'config/' --exclude 'data/' --exclude 'vpn/wireguard/*.conf' \
  --exclude 'vpn/openvpn/*.ovpn' --exclude 'vpn/openvpn/*.key' --exclude 'vpn/openvpn/*.crt' ./ "$SERVER:$SERVER_DIR/"

echo "3/3 build and run on the server"
ssh_ bash -s -- "$SERVER_DIR" "$TAG" \
  "${URL[transport]}" "${COMMIT[transport]}" "${URL[tarabari]}" "${COMMIT[tarabari]}" "${URL[web]}" "${COMMIT[web]}" <<'REMOTE'
set -euo pipefail
dir=$1 tag=$2
src=$(dirname "$dir")/src
checkout() { # name url commit
  [ -d "$src/$1/.git" ] || git clone --quiet "$2" "$src/$1"
  git -C "$src/$1" fetch --quiet origin
  git -C "$src/$1" checkout --quiet --force --detach "$3"
  echo "  $1 at $(git -C "$src/$1" log -1 --format='%h %s')"
}
mkdir -p "$src"
checkout transport_backend "$3" "$4"
checkout tarabari_backend "$5" "$6"
checkout transport_front "$7" "$8"
cd "$dir"
# the builds take the sources from ../src (one line each in .env, set here so a new .env needs nothing)
for pair in "TRANSPORT_SRC=$src/transport_backend" "TARABARI_SRC=$src/tarabari_backend" "FRONT_SRC=$src/transport_front"; do
  key=${pair%%=*}
  grep -q "^$key=" .env && sed -i -E "s#^$key=.*#$pair#" .env || echo "$pair" >> .env
done
sed -i -E "s/^TAG=.*/TAG=$tag/" .env
docker compose build transport tarabari web
docker compose up -d
docker compose exec -T transport npm run typeorm -- migration:run
docker compose exec -T tarabari npm run typeorm -- migration:run
docker compose ps
REMOTE
echo "done: $SERVER runs $TAG (back to an older one: ./ship.sh $SERVER <older TAG>)"
