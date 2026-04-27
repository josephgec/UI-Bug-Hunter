#!/usr/bin/env bash
# Shared scan script — used by the GitLab template, the CircleCI orb, and the
# Bitbucket Pipelines example. Reads its inputs from environment variables so
# it stays the same across CI providers.
#
# Required env: UBH_TOKEN, UBH_PROJECT_ID, UBH_URLS
# Optional env: UBH_API_URL, UBH_VIEWPORTS, UBH_SEVERITY_THRESHOLD,
#               UBH_MIN_CONFIDENCE, UBH_POLL_TIMEOUT_SECONDS, UBH_OVERAGE_BEHAVIOR
set -euo pipefail

UBH_API_URL="${UBH_API_URL:-https://api.uibughunter.dev}"
UBH_VIEWPORTS="${UBH_VIEWPORTS:-desktop}"
UBH_SEVERITY_THRESHOLD="${UBH_SEVERITY_THRESHOLD:-high}"
UBH_MIN_CONFIDENCE="${UBH_MIN_CONFIDENCE:-0.6}"
UBH_POLL_TIMEOUT_SECONDS="${UBH_POLL_TIMEOUT_SECONDS:-300}"
UBH_OVERAGE_BEHAVIOR="${UBH_OVERAGE_BEHAVIOR:-hard-fail}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 2
fi

if [ -z "${UBH_TOKEN:-}" ] || [ -z "${UBH_PROJECT_ID:-}" ] || [ -z "${UBH_URLS:-}" ]; then
  echo "UBH_TOKEN, UBH_PROJECT_ID, and UBH_URLS are required." >&2
  exit 2
fi

VIEWPORTS_JSON="$(printf '%s' "${UBH_VIEWPORTS}" | jq -R 'split(",")')"
declare -a scan_ids=()

while IFS= read -r url; do
  [ -z "${url}" ] && continue
  body="$(jq -n \
    --arg projectId "${UBH_PROJECT_ID}" \
    --arg url "${url}" \
    --argjson viewports "${VIEWPORTS_JSON}" \
    '{projectId:$projectId, url:$url, viewports:$viewports}')"

  http_status=$(curl -sS -o /tmp/ubh-resp.json -w "%{http_code}" -X POST "${UBH_API_URL}/api/v1/scans" \
    -H "authorization: Bearer ${UBH_TOKEN}" \
    -H "content-type: application/json" \
    -d "${body}")

  if [ "${http_status}" = "402" ]; then
    case "${UBH_OVERAGE_BEHAVIOR}" in
      hard-fail) echo "Quota exceeded for ${url}" >&2; exit 1;;
      soft-fail) echo "Quota exceeded for ${url} (skipping)" >&2; continue;;
      continue)  echo "Quota exceeded for ${url} (skipping)"; continue;;
    esac
  fi

  if [ "${http_status}" -ge 300 ]; then
    echo "Scan submission failed for ${url} (HTTP ${http_status})" >&2
    cat /tmp/ubh-resp.json >&2 || true
    exit 1
  fi

  scan_id="$(jq -r '.scanId' /tmp/ubh-resp.json)"
  scan_ids+=("${scan_id}")
  echo "  submitted ${scan_id} for ${url}"
done <<< "${UBH_URLS}"

deadline=$(( $(date +%s) + UBH_POLL_TIMEOUT_SECONDS ))
total_flagged=0

for scan_id in "${scan_ids[@]}"; do
  while true; do
    if [ "$(date +%s)" -gt "${deadline}" ]; then
      echo "Polling timed out for ${scan_id}" >&2
      break
    fi
    status="$(curl -fsS "${UBH_API_URL}/api/v1/scans/${scan_id}" \
      -H "authorization: Bearer ${UBH_TOKEN}" | jq -r '.status')"
    if [ "${status}" = "COMPLETED" ] || [ "${status}" = "FAILED" ]; then
      break
    fi
    sleep 5
  done

  findings_json="$(curl -fsS "${UBH_API_URL}/api/v1/scans/${scan_id}/findings?min_confidence=${UBH_MIN_CONFIDENCE}" \
    -H "authorization: Bearer ${UBH_TOKEN}")"
  flagged="$(printf '%s' "${findings_json}" | jq --arg t "${UBH_SEVERITY_THRESHOLD}" '
    .findings | map(select(
      ($t == "low") or
      ($t == "medium" and (.severity == "medium" or .severity == "high" or .severity == "critical")) or
      ($t == "high"   and (.severity == "high"   or .severity == "critical")) or
      ($t == "critical" and .severity == "critical")
    )) | length')"
  echo "  scan ${scan_id}: ${flagged} finding(s) at or above ${UBH_SEVERITY_THRESHOLD}"
  total_flagged=$(( total_flagged + flagged ))
done

if [ "${total_flagged}" -gt 0 ]; then
  echo "UI Bug Hunter: ${total_flagged} finding(s) at or above ${UBH_SEVERITY_THRESHOLD}." >&2
  exit 1
fi
echo "UI Bug Hunter: clean."
