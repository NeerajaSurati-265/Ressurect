#!/usr/bin/env bash
# Local proof for B5 (no AWS): runs the REAL static-react.yml and backend-container.yml blocks against a
# fixture full-stack app. The backend image runs in Docker; the frontend is built with the wiring inputs
# (git clone of a local repo, a stub `aws s3 sync` that copies to a folder); the built JS is then served and checked.
#   scripts/local_fullstack_check.sh <env|localhost>
set -euo pipefail
cd "$(dirname "$0")/.."
KIND=${1:-env}
FX=$(realpath backend/tests/fixtures/fullstack)
WORK=$(mktemp -d)
FAKE_URL="https://abcd1234.lambda-url.us-east-1.on.aws"
trap 'docker rm -f rz-fs-local >/dev/null 2>&1 || true; [ -n "${HTTP_PID:-}" ] && kill $HTTP_PID 2>/dev/null || true; rm -rf "$WORK"' EXIT
block() { python3 -I -c 'import sys,yaml; print(yaml.safe_load(open(sys.argv[1]))["phases"]["build"]["commands"][0])' "$1"; }

echo "== backend: build the image with the real backend-container.yml block"
block buildspec/backend-container.yml > "$WORK/backend.sh"
mkdir -p "$WORK/b"
(cd "$WORK/b" && RESURRECT_LOCAL=1 LOCAL_SRC="$FX/backend" REPO_URL=local RES_ID=r-local1 RUNTIME=python \
  ENTRY="uvicorn main:app --host 0.0.0.0 --port 8000" APP_PORT=8000 APP_DIR=. bash "$WORK/backend.sh") >"$WORK/backend.log" 2>&1 \
  || { tail -20 "$WORK/backend.log"; exit 1; }
docker run -d --read-only --tmpfs /tmp:exec --user 1000:1000 --name rz-fs-local -p 18081:8000 resurrect-local:r-local1 >/dev/null
for i in $(seq 1 40); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/notes || true); [ "$code" = 200 ] && break; sleep 1; done
echo "backend GET /notes -> $code"
curl -s -X POST "http://127.0.0.1:18081/notes?text=hello" >/dev/null
echo "backend with Origin header: $(curl -si -H 'Origin: https://graves.example' http://127.0.0.1:18081/notes | tr -d '\r' | grep -i -E '^(HTTP|access-control-allow-origin|\[)' | tr '\n' ' ')"

echo "== frontend ($KIND): build with the real static-react.yml block"
SRC="$WORK/repo"; cp -r "$FX/vite-$KIND" "$SRC"
git -C "$SRC" init -q && git -C "$SRC" add -A && git -C "$SRC" -c user.email=a@b -c user.name=t commit -qm fixture
mkdir -p "$WORK/bin" "$WORK/s3"
cat > "$WORK/bin/aws" <<'STUB'
#!/bin/bash
# aws s3 sync <dir> s3://bucket/graves/<id>/  ->  copy into $S3_DIR
[ "$1 $2" = "s3 sync" ] || exit 0
mkdir -p "$S3_DIR" && cp -r "$3"/. "$S3_DIR"/
STUB
chmod +x "$WORK/bin/aws"
block buildspec/static-react.yml > "$WORK/frontend.sh"
if [ "$KIND" = env ]; then WIRE="WIRE_ENV_NAMES=VITE_API_URL"; else WIRE="REWRITE_ORIGINS=http://localhost:8000"; fi
(cd "$WORK" && env PATH="$WORK/bin:$PATH" S3_DIR="$WORK/s3" REPO_URL="$SRC" RES_ID=r-local1 STACK=react-vite \
  APP_DIR=frontend BUCKET=local COMMIT_SHA=x WIRE_URL="$FAKE_URL" $WIRE bash "$WORK/frontend.sh") 2>&1 | grep -E "Wired|Rewrote|phase|error" || true

echo "== serve the built site and inspect its JS"
python3 -m http.server 18082 --directory "$WORK/s3" >/dev/null 2>&1 & HTTP_PID=$!
for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:18082/ && break; sleep 0.5; done
JS=$(curl -s http://127.0.0.1:18082/ | grep -o 'assets/[^"]*\.js' | head -1)
curl -s "http://127.0.0.1:18082/$JS" > "$WORK/main.js"
echo "built JS: $JS ($(wc -c < "$WORK/main.js") bytes)"
grep -q "$FAKE_URL" "$WORK/main.js" && echo "PASS: built JS contains the backend URL" || { echo "FAIL: backend URL missing"; exit 1; }
if grep -q "localhost:8000" "$WORK/main.js"; then echo "FAIL: localhost:8000 is still in the built JS"; exit 1; fi
echo "PASS: no localhost:8000 left"
if [ "$KIND" = localhost ]; then grep -q "http://localhost:3000" "$WORK/main.js" && echo "PASS: unrelated http://localhost:3000 untouched" || { echo "FAIL: unrelated origin changed"; exit 1; }; fi
echo "source untouched: $(grep -c "$FAKE_URL" "$SRC/frontend/src/main.jsx" || true) matches in main.jsx (expect 0)"
