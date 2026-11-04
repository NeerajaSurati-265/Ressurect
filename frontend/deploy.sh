#!/usr/bin/env bash
# Deploys the Resurrect UI and the RIP page.
#
# Required env vars:
#   BUCKET                  S3 bucket holding ui/ and graves/
#   UI_DISTRIBUTION_ID      CloudFront distribution serving s3://$BUCKET/ui/
#   GRAVES_DISTRIBUTION_ID  CloudFront distribution serving s3://$BUCKET/graves/
#   UI_URL                  Public URL of the UI, e.g. https://d1ui.cloudfront.net (RIP page links here)
#   API_BASE_URL            Public URL of the API (Lambda function URL)
#
# Usage: BUCKET=... UI_DISTRIBUTION_ID=... GRAVES_DISTRIBUTION_ID=... UI_URL=... API_BASE_URL=... ./deploy.sh
set -euo pipefail

export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

missing=()
for v in BUCKET UI_DISTRIBUTION_ID GRAVES_DISTRIBUTION_ID UI_URL API_BASE_URL; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "deploy.sh: missing required environment variable(s): ${missing[*]}" >&2
  echo "Set all of: BUCKET UI_DISTRIBUTION_ID GRAVES_DISTRIBUTION_ID UI_URL API_BASE_URL" >&2
  exit 1
fi

for tool in aws npm sed; do
  command -v "$tool" >/dev/null 2>&1 || { echo "deploy.sh: '$tool' is not installed or not on PATH" >&2; exit 1; }
done

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Building the UI against $API_BASE_URL (mock off)"
VITE_USE_MOCK=false VITE_API_BASE_URL="$API_BASE_URL" npm run build

[[ -f dist/index.html ]] || { echo "deploy.sh: build did not produce dist/index.html" >&2; exit 1; }

echo "==> Uploading hashed assets (immutable)"
if [[ -d dist/assets ]]; then
  aws s3 sync dist/assets "s3://$BUCKET/ui/assets" --delete \
    --cache-control "max-age=31536000, immutable"
fi

echo "==> Uploading index.html and other unhashed files (no-cache)"
aws s3 sync dist/ "s3://$BUCKET/ui/" --delete \
  --exclude "assets/*" \
  --cache-control "no-cache"

echo "==> Uploading the RIP page"
rip_tmp="$(mktemp)"
trap 'rm -f "$rip_tmp"' EXIT
# escape characters that are special in a sed replacement
ui_url_escaped="$(printf '%s' "${UI_URL%/}/" | sed -e 's/[\/&|]/\\&/g')"
sed "s|__RESURRECT_UI_URL__|$ui_url_escaped|g" rip/index.html > "$rip_tmp"
if grep -q "__RESURRECT_UI_URL__" "$rip_tmp"; then
  echo "deploy.sh: failed to substitute __RESURRECT_UI_URL__ in rip/index.html" >&2
  exit 1
fi
aws s3 cp "$rip_tmp" "s3://$BUCKET/graves/_rip/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache"

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$UI_DISTRIBUTION_ID" --paths "/*" >/dev/null
aws cloudfront create-invalidation --distribution-id "$GRAVES_DISTRIBUTION_ID" --paths "/_rip/*" >/dev/null

echo "==> Done. UI: ${UI_URL%/}/"
