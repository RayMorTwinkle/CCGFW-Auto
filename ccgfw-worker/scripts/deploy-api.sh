#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCRIPT_NAME="ccgfw-auto-buy"
ACCOUNT_ID="b8ff6d1be78914e620621e5911620166"
API_BASE="https://api.cloudflare.com/client/v4"
WORKER_FILE="dist/worker.mjs"
CRON_EXPRESSION="0 4,16 * * *"
KV_NAMESPACE_TITLE="ccgfw-auto-buy-status"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

load_env() {
  [[ -f .env ]] || return 0
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Missing required value in .env: $name"
}

api() {
  local method="$1"
  local path="$2"
  local output="$3"
  shift 3

  local status
  status="$(curl --http1.1 -sS --connect-timeout 15 --max-time 60 \
    -X "$method" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "$@" \
    -o "$output" \
    -w "%{http_code}" \
    "$API_BASE$path")" || return 1

  [[ "$status" =~ ^2 ]] || {
    echo "Cloudflare API HTTP $status:" >&2
    cat "$output" >&2
    echo >&2
    return 1
  }
}

put_secret() {
  local name="$1"
  local value="$2"
  local body="/tmp/ccgfw-worker-secret-${name}.json"
  local output="/tmp/ccgfw-worker-secret-${name}.out.json"

  printf '{"name":%s,"text":%s,"type":"secret_text"}' \
    "$(json_string "$name")" \
    "$(json_string "$value")" > "$body"

  api PUT "/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/secrets" "$output" --data-binary "@$body" \
    || fail "Failed to upload secret: $name"
}

json_string() {
  local value="$1"
  JSON_VALUE="$value" node -e 'process.stdout.write(JSON.stringify(process.env.JSON_VALUE || ""))'
}

json_get_kv_id_by_title() {
  local file="$1"
  local title="$2"
  KV_TITLE="$title" node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const item = (data.result || []).find((entry) => entry.title === process.env.KV_TITLE);
    if (item) process.stdout.write(item.id);
  ' "$file"
}

json_get_result_id() {
  local file="$1"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (data.result && data.result.id) process.stdout.write(data.result.id);
  ' "$file"
}

ensure_kv_namespace() {
  local list_out="/tmp/ccgfw-worker-kv-list.out.json"
  local create_body="/tmp/ccgfw-worker-kv-create.json"
  local create_out="/tmp/ccgfw-worker-kv-create.out.json"
  local namespace_id

  api GET "/accounts/$ACCOUNT_ID/storage/kv/namespaces?per_page=100" "$list_out" \
    || fail "Failed to list KV namespaces."

  namespace_id="$(json_get_kv_id_by_title "$list_out" "$KV_NAMESPACE_TITLE")"
  if [[ -n "$namespace_id" ]]; then
    printf '%s' "$namespace_id"
    return
  fi

  printf '{"title":%s}' "$(json_string "$KV_NAMESPACE_TITLE")" > "$create_body"
  api POST "/accounts/$ACCOUNT_ID/storage/kv/namespaces" "$create_out" --data-binary "@$create_body" \
    || fail "Failed to create KV namespace: $KV_NAMESPACE_TITLE"

  namespace_id="$(json_get_result_id "$create_out")"
  [[ -n "$namespace_id" ]] || fail "Cloudflare created KV namespace but no namespace id was returned."
  printf '%s' "$namespace_id"
}

echo "==> CCGFW Worker deploy via Cloudflare API"

need_cmd curl
need_cmd node
need_cmd npm
load_env

require_env CLOUDFLARE_API_TOKEN
require_env CCGFW_COOKIE

if [[ ! -d node_modules ]]; then
  echo "==> Installing npm dependencies"
  npm install
fi

echo "==> Building Worker bundle"
npm run build
node --check "$WORKER_FILE"

METADATA="$(mktemp /tmp/ccgfw-worker-metadata.XXXXXX)"
UPLOAD_OUT="/tmp/ccgfw-worker-upload.out.json"
SCHEDULE_OUT="/tmp/ccgfw-worker-schedule.out.json"

echo "==> Ensuring KV namespace"
KV_NAMESPACE_ID="$(ensure_kv_namespace)"
echo "KV namespace: $KV_NAMESPACE_TITLE ($KV_NAMESPACE_ID)"

cat > "$METADATA" <<JSON
{
  "main_module": "worker.mjs",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["global_fetch_strictly_public"],
  "bindings": [
    { "type": "plain_text", "name": "CCGFW_BASE_URL", "text": "https://www.okgg.top" },
    { "type": "plain_text", "name": "CCGFW_SHOP_ID", "text": "8" },
    { "type": "plain_text", "name": "CCGFW_COUPON", "text": "" },
    { "type": "plain_text", "name": "CCGFW_AUTORENEW", "text": "1" },
    { "type": "plain_text", "name": "CCGFW_DISABLE_OTHERS", "text": "1" },
    { "type": "kv_namespace", "name": "STATUS_KV", "namespace_id": "$KV_NAMESPACE_ID" }
  ]
}
JSON

echo "==> Uploading Worker script"
status="$(curl --http1.1 -sS --connect-timeout 15 --max-time 60 \
  -X PUT \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=@$METADATA;type=application/json" \
  -F "worker.mjs=@$WORKER_FILE;type=application/javascript+module" \
  -o "$UPLOAD_OUT" \
  -w "%{http_code}" \
  "$API_BASE/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME")" || {
    cat "$UPLOAD_OUT" >&2 2>/dev/null || true
    fail "Failed to upload Worker script."
  }

[[ "$status" =~ ^2 ]] || {
  echo "Cloudflare API HTTP $status:" >&2
  cat "$UPLOAD_OUT" >&2
  echo >&2
  fail "Failed to upload Worker script."
}

echo "==> Uploading secrets"
put_secret CCGFW_COOKIE "$CCGFW_COOKIE"

echo "==> Updating cron trigger"
SCHEDULE_BODY="$(mktemp /tmp/ccgfw-worker-schedule.XXXXXX)"
cat > "$SCHEDULE_BODY" <<JSON
[
  { "cron": "$CRON_EXPRESSION" }
]
JSON

api PUT "/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/schedules" "$SCHEDULE_OUT" --data-binary "@$SCHEDULE_BODY" \
  || fail "Failed to update cron trigger."

echo
echo "==> Done"
echo "Schedule: Beijing time 00:00 and 12:00 every day."
echo "Cloudflare dashboard: https://dash.cloudflare.com/?to=/:account/workers/services/view/$SCRIPT_NAME/production"
echo "Worker name: $SCRIPT_NAME"
echo "Status page: https://$SCRIPT_NAME.cyb2831173936.workers.dev/"
echo "Health check: https://$SCRIPT_NAME.cyb2831173936.workers.dev/health"
echo "Manual run: curl -X POST 'https://$SCRIPT_NAME.cyb2831173936.workers.dev/run'"
