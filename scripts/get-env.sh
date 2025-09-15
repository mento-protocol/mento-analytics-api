#!/bin/bash

# Ensure the script fails on any error
set -euo pipefail

# Source shared utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../scripts/shared-utils.sh"

# Main script logic
target_service=$(get_target_service_name)

# Show which service we're fetching environment variables for
if [[ "$target_service" == "$MAIN_SERVICE_NAME" ]]; then
    print_info "Environment variables for main service: ${target_service}"
else
    print_info "Environment variables for preview service: ${target_service}"
fi

# Fetch the environment variables and store in a variable to ensure we have complete JSON
raw_env=$(gcloud run services describe "$target_service" \
  --platform=managed \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format="json") || exit 1

# Check if the output is valid JSON
if ! echo "${raw_env}" | jq empty > /dev/null 2>&1; then
  print_error "Invalid JSON output from gcloud"
  exit 1
fi

# Extract and format environment variables
env_vars=$(echo "${raw_env}" | jq -r '.spec.template.spec.containers[0].env[]? // empty | "\(.name)=\(.value)"')

# Check if we have any environment variables
if [[ -z "$env_vars" ]]; then
    print_warning "No environment variables found for service: $target_service"
    exit 0
fi

# Display the environment variables in a clean format
echo "$env_vars" | while IFS='=' read -r name value; do
    if [[ -n "$name" && -n "$value" ]]; then
        printf "%-30s %s\n" "$name" "$value"
    fi
done

# Generate the Cloud Console URL for the service
console_url="https://console.cloud.google.com/run/detail/${REGION}/${target_service}/yaml/view?project=${PROJECT_ID}"

# Add clickable link to full service details
printf "\n\033[34mView service details:\033[0m \033[34m\033[4m%s\033[0m\n" "$console_url"
