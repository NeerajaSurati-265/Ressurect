#!/usr/bin/env bash
# Local check for buildspec/backend-container.yml: runs its build block against a fixture app with
# RESURRECT_LOCAL=1 (no clone, no ECR), then starts the image with plain `docker run` and curls it.
#   scripts/local_backend_build.sh <fixture-dir> <python|node> "<entry>" <port> [django-project] [path-to-curl]
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=$(realpath "$1"); RUNTIME=$2; ENTRY=$3; PORT=$4; DJ=${5:-}; CURL_PATH=${6:-/}
WORK=$(mktemp -d)
trap 'docker logs rz-local 2>&1 | tail -6; docker rm -f rz-local >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
python3 -I - "$WORK/block.sh" <<'PY'
import sys, yaml
spec = yaml.safe_load(open("buildspec/backend-container.yml"))
open(sys.argv[1], "w").write(spec["phases"]["build"]["commands"][0])
PY
(cd "$WORK" && RESURRECT_LOCAL=1 LOCAL_SRC="$SRC" REPO_URL=local RES_ID=r-local1 RUNTIME="$RUNTIME" \
  ENTRY="$ENTRY" APP_PORT="$PORT" DJANGO_PROJECT="$DJ" APP_DIR=. bash block.sh)
docker run -d --read-only --tmpfs /tmp:exec --user 1000:1000 --name rz-local -p 18080:"$PORT" resurrect-local:r-local1 >/dev/null
for i in $(seq 1 40); do
  code=$(curl -s -o "$WORK/body" -w '%{http_code}' "http://127.0.0.1:18080$CURL_PATH" || true)
  [ "$code" != "000" ] && break; sleep 1
done
echo "GET $CURL_PATH -> $code: $(head -c 120 "$WORK/body")"
# optional extra checks, one curl argument string per line in $EXTRA (use {} for the base URL)
while IFS= read -r line; do
  [ -z "$line" ] && continue
  echo "curl ${line//\{\}/http://127.0.0.1:18080} -> $(eval "curl -s -m 20 -w ' [%{http_code}]' ${line//\{\}/http://127.0.0.1:18080}" | head -c 160)"
done <<< "${EXTRA:-}"
echo "manifest mediaType: $(docker image inspect resurrect-local:r-local1 --format '{{.Architecture}}/{{.Os}}')"
