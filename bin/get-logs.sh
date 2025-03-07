#!/bin/bash

# Ensure the script fails on any error
set -euo pipefail

project_name="mento-prod"
service_name="mento-analytics-api"
region="us-central1"

# Fetch the logs and store in a variable to ensure we have complete JSON
raw_logs=$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${service_name} AND severity>=WARNING" \
  --project=${project_name} \
  --limit=50 \
  --format="json") || exit 1

# Check if the output is valid JSON
if ! echo "${raw_logs}" | jq empty > /dev/null 2>&1; then
  echo "Error: Invalid JSON output from gcloud"
  exit 1
fi

# Process and format the logs
echo "${raw_logs}" | jq -r ' reverse | .[] | if .severity == "ERROR" then
  "\u001b[31m[\(.severity)]  \u001b[0m \u001b[33m\(.timestamp | sub("T"; " ") | sub("\\..*"; ""))\u001b[0m: \(.jsonPayload.message // .textPayload)"
else
  "[\(.severity)] \u001b[33m\(.timestamp | sub("T"; " ") | sub("\\..*"; ""))\u001b[0m: \(.jsonPayload.message // .textPayload)"
end'

# Generate the Cloud Console URL
console_url="https://console.cloud.google.com/run/detail/${region}/${service_name}/logs?project=${project_name}"

# Add clickable link to full logs with proper formatting
printf "\n\033[34mView full logs:\033[0m \033[34m\033[4m%s\033[0m\n" "$console_url"