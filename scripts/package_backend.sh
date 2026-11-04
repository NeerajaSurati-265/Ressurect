#!/usr/bin/env bash
# Builds build/api.zip for the API and reaper Lambdas (Python 3.12, x86_64).
# Run from the repo root: scripts/package_backend.sh
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf build/pkg build/api.zip
mkdir -p build/pkg

python3 -m pip install \
  -r backend/requirements.txt \
  -t build/pkg \
  --platform manylinux2014_x86_64 \
  --only-binary=:all: \
  --python-version 3.12 \
  --implementation cp \
  --upgrade

cp -r backend/app build/pkg/app
find build/pkg -name "__pycache__" -type d -prune -exec rm -rf {} +

(cd build/pkg && zip -qr ../api.zip .)

echo "Built build/api.zip ($(du -h build/api.zip | cut -f1))"
