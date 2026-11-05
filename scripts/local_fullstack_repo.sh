#!/usr/bin/env bash
# Local dry run of one full-stack repo, exactly as B5 would raise it (no AWS):
#   1. the real autopsy (flags on) decides frontend/backend dirs, wiring and CORS
#   2. the real backend-container.yml block builds the backend image; it runs in Docker (Lambda-like flags)
#   3. the real static-react.yml block builds the frontend with the same wiring inputs the state machine sends
#   4. the built JS is served and inspected
# usage: scripts/local_fullstack_repo.sh <repo-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(realpath "$1"); NAME=$(basename "$REPO")
FAKE_URL="https://abcd1234.lambda-url.us-east-1.on.aws"; ORIGIN="https://d111.cloudfront.net"
WORK=$(mktemp -d); CN="rz-fs-$$"
trap 'docker rm -f $CN >/dev/null 2>&1 || true; [ -n "${HTTP_PID:-}" ] && kill $HTTP_PID 2>/dev/null || true; rm -rf "$WORK"' EXIT
block() { python3 -I -c 'import sys,yaml; print(yaml.safe_load(open(sys.argv[1]))["phases"]["build"]["commands"][0])' "$1"; }
fail() { echo "FAIL: $*"; exit 1; }

echo "=== $NAME"
eval "$(backend/.venv/bin/python -I scripts/fullstack_plan.py "$REPO")"
[ "$FS" = 1 ] || fail "not detected as full-stack"
echo "frontend=$FE_DIR ($FE_STACK) backend=$BE_DIR ($BE_RUNTIME: $BE_ENTRY :$BE_PORT) wiring=$WIRING app_cors=$APP_CORS"
echo "wire env: [$WIRE_ENV_NAMES] rewrite: [$REWRITE_ORIGINS] warnings: [$WARNINGS]"

# ---- backend image + container
block buildspec/backend-container.yml > "$WORK/backend.sh"; mkdir -p "$WORK/b"
(cd "$WORK/b" && RESURRECT_LOCAL=1 LOCAL_SRC="$REPO" REPO_URL=local RES_ID=r-local1 RUNTIME="$BE_RUNTIME" ENTRY="$BE_ENTRY" \
  APP_PORT="$BE_PORT" DJANGO_PROJECT="$BE_DJANGO" APP_DIR="$BE_DIR" bash "$WORK/backend.sh") >"$WORK/backend.log" 2>&1 || { tail -25 "$WORK/backend.log"; fail "backend image build"; }
docker run -d --read-only --tmpfs /tmp:exec --user 1000:1000 -e PORT=8080 --name "$CN" -p 0:"$BE_PORT" resurrect-local:r-local1 >/dev/null
HP=$(docker port "$CN" "$BE_PORT"/tcp | head -1 | sed 's/.*://')
BASE="http://127.0.0.1:$HP"; up=""
for i in $(seq 1 40); do
  for p in $BE_PROBES; do c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p" || true); [ "$c" != 000 ] && [ "$c" -lt 500 ] && { up="$p -> $c"; break 2; }; done; sleep 1
done
[ -n "$up" ] || { docker logs "$CN" 2>&1 | tail; fail "backend did not answer"; }
echo "backend up: GET $up"
case "$NAME" in
  *express*) echo "backend JSON: $(curl -s $BASE/api/message)";;
  *proxy*) curl -s -X POST -H 'Content-Type: application/json' -d '{"text":"hi"}' $BASE/api/notes >/dev/null; echo "backend add-then-list: $(curl -s $BASE/api/notes)";;
  *) curl -s -X POST -H 'Content-Type: application/json' -d '{"text":"hi"}' $BASE/notes >/dev/null; echo "backend add-then-list: $(curl -s $BASE/notes)";;
esac
P=/notes; case "$NAME" in *express*) P=/api/message;; *proxy*) P=/api/notes;; esac
echo "app-level CORS headers on GET $P (Origin: $ORIGIN): $(curl -si -H "Origin: $ORIGIN" $BASE$P | tr -d '\r' | grep -i '^access-control' | tr '\n' ' ')"
echo "app-level preflight (OPTIONS): $(curl -si -X OPTIONS -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' $BASE$P | tr -d '\r' | grep -i -E '^(HTTP|access-control)' | tr '\n' ' ')"

# ---- frontend with the wiring the state machine would send
SRC="$WORK/repo"; cp -r "$REPO" "$SRC"
git -C "$SRC" add -A >/dev/null 2>&1; git -C "$SRC" -c user.email=a@b -c user.name=t commit -qm snapshot >/dev/null 2>&1 || true
mkdir -p "$WORK/bin" "$WORK/s3"
printf '#!/bin/bash\n[ "$1 $2" = "s3 sync" ] || exit 0\nmkdir -p "$S3_DIR" && cp -r "$3"/. "$S3_DIR"/\n' > "$WORK/bin/aws"; chmod +x "$WORK/bin/aws"
block buildspec/static-react.yml > "$WORK/frontend.sh"
WIRE_VARS=(); [ -n "$WIRE_ENV_NAMES$REWRITE_ORIGINS" ] && WIRE_VARS=(WIRE_URL="$FAKE_URL" WIRE_ENV_NAMES="$WIRE_ENV_NAMES" REWRITE_ORIGINS="$REWRITE_ORIGINS")
(cd "$WORK" && env PATH="$WORK/bin:$PATH" S3_DIR="$WORK/s3" REPO_URL="$SRC" RES_ID=r-local1 STACK="$FE_STACK" APP_DIR="$FE_DIR" \
  BUCKET=local COMMIT_SHA=x "${WIRE_VARS[@]}" bash "$WORK/frontend.sh") >"$WORK/frontend.log" 2>&1 || { tail -25 "$WORK/frontend.log"; fail "frontend build"; }
grep -E "Wired|Rewrote" "$WORK/frontend.log" || true

# ---- serve and inspect the built JS
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$WORK/s3" >"$WORK/http.log" 2>&1 & HTTP_PID=$!
for i in $(seq 1 20); do SP=$(grep -o 'port [0-9]*' "$WORK/http.log" | head -1 | cut -d' ' -f2 || true); [ -n "$SP" ] && break; sleep 0.3; done
JS=$(curl -s "http://127.0.0.1:$SP/" | grep -o '[A-Za-z0-9_/.-]*static/js/[^"]*\.js\|[A-Za-z0-9_/.-]*assets/[^"]*\.js' | head -1 | sed 's#^/*r-local1/##; s#^/##')
[ -n "$JS" ] || fail "no script tag in the built index.html"
curl -s "http://127.0.0.1:$SP/$JS" > "$WORK/main.js"; echo "built JS: $JS ($(wc -c < "$WORK/main.js") bytes)"
case "$WIRING" in
  env|localhost)
    grep -q "$FAKE_URL" "$WORK/main.js" && echo "PASS: built JS contains the backend URL" || fail "backend URL missing from the built JS"
    for o in ${REWRITE_ORIGINS//,/ }; do grep -qF "$o" "$WORK/main.js" && fail "$o is still in the built JS"; done
    [ -z "$REWRITE_ORIGINS" ] || echo "PASS: no localhost origin left";;
  proxy)
    grep -q "$FAKE_URL" "$WORK/main.js" && fail "unexpected backend URL in a proxy build"
    echo "PASS (expected): proxy build is unwired; autopsy warns: $WARNINGS";;
esac
echo "RESULT $NAME: ok"
