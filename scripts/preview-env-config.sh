#!/bin/bash

# Centralized environment configuration for preview deployments
# This copies .env.example to .env and reads from it

# Get the script directory - this script is always in the scripts/ folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Copy .env.example to .env if it doesn't exist
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
    if [ -f "${PROJECT_ROOT}/.env.example" ]; then
        cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
        echo "Created .env from .env.example"
    else
        echo "Error: .env.example not found at ${PROJECT_ROOT}/.env.example"
        exit 1
    fi
fi

# Parse .env and export the API URLs
# This reads the file and exports only the API URL variables
ENV_FILE="${PROJECT_ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
    # Export API URLs from .env
    eval $(grep -E '^(BLOCKSTREAM_API_URL|BLOCKCHAIN_INFO_API_URL|EXCHANGE_RATES_API_URL|COINMARKETCAP_API_URL)=' "$ENV_FILE" | sed 's/^/export /')
else
    echo "Error: .env not found at $ENV_FILE"
    exit 1
fi

# Runtime configuration for preview environments (overrides)
export NODE_ENV="production"
export ENVIRONMENT="preview"

# Build a comma-separated string of all env vars for Cloud Run
# This makes it easy to use in gcloud commands
build_env_vars_string() {
    local branch_name="$1"
    local branch_tag="$2"
    local short_sha="$3"
    
    cat << EOF
RELEASE_VERSION=${branch_tag}-${short_sha},\
ENVIRONMENT=${ENVIRONMENT},\
PREVIEW_BRANCH=${branch_name},\
NODE_ENV=${NODE_ENV},\
BLOCKSTREAM_API_URL=${BLOCKSTREAM_API_URL},\
BLOCKCHAIN_INFO_API_URL=${BLOCKCHAIN_INFO_API_URL},\
EXCHANGE_RATES_API_URL=${EXCHANGE_RATES_API_URL},\
COINMARKETCAP_API_URL=${COINMARKETCAP_API_URL}
EOF
}

# Export the function so it can be used by sourcing scripts
export -f build_env_vars_string
