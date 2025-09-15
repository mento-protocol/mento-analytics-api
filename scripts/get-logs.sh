#!/bin/bash

# Ensure the script fails on any error
set -euo pipefail

# Source shared utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../scripts/shared-utils.sh"

# Main script logic
target_service=$(get_target_service_name)

# Show which service we're fetching logs for
if [[ "$target_service" == "$MAIN_SERVICE_NAME" ]]; then
    print_info "Fetching logs for main service: ${target_service}"
else
    print_info "Fetching logs for preview service: ${target_service}"
fi

# Fetch the logs and store in a variable to ensure we have complete JSON
raw_logs=$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${target_service} AND severity>=WARNING" \
  --project=${PROJECT_ID} \
  --limit=50 \
  --format="json") || exit 1

# Check if the output is valid JSON
if ! echo "${raw_logs}" | jq empty > /dev/null 2>&1; then
  print_error "Invalid JSON output from gcloud"
  exit 1
fi

# Process and format the logs
echo "${raw_logs}" | jq -r ' reverse | .[] | if .severity == "ERROR" then
  "\u001b[31m[\(.severity)]  \u001b[0m \u001b[33m\(.timestamp | sub("T"; " ") | sub("\\..*"; ""))\u001b[0m: \(.jsonPayload.message // .textPayload)"
else
  "[\(.severity)] \u001b[33m\(.timestamp | sub("T"; " ") | sub("\\..*"; ""))\u001b[0m: \(.jsonPayload.message // .textPayload)"
end'

# Generate the Cloud Console URL
console_url="https://console.cloud.google.com/run/detail/${REGION}/${target_service}/logs?project=${PROJECT_ID}"

# Add clickable link to full logs with proper formatting
printf "\n\033[34mView full logs:\033[0m \033[34m\033[4m%s\033[0m\n" "$console_url"