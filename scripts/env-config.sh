#!/bin/bash

# Centralized environment configuration for all deployments
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

# Parse .env and export all environment variables
# This reads the file and exports all environment variables (excluding comments and empty lines)
ENV_FILE="${PROJECT_ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
    # Export all non-empty environment variables from .env (excluding comments, empty lines, and empty values)
    eval $(grep -E '^[A-Z_][A-Z0-9_]*=.+$' "$ENV_FILE" | sed 's/^/export /')
else
    echo "Error: .env not found at $ENV_FILE"
    exit 1
fi

# Runtime configuration for deployments (overrides)
# These can be overridden by calling scripts
export NODE_ENV="production"
export ENVIRONMENT="preview"
export SENTRY_ENVIRONMENT="preview"

# Build a comma-separated string of all env vars for Cloud Run
# This makes it easy to use in gcloud commands
build_env_vars_string() {
    local branch_name="$1"
    local branch_tag="$2"
    local short_sha="$3"
    
    # Start with runtime configuration
    local env_vars="RELEASE_VERSION=${branch_tag}-${short_sha},ENVIRONMENT=${ENVIRONMENT},SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT},PREVIEW_BRANCH=${branch_name},NODE_ENV=${NODE_ENV}"
    
    # Add all environment variables from .env file that are currently exported
    # This dynamically includes all env vars without hardcoding them
    # Exclude API keys that are managed as Cloud Run secrets and Cloud Run reserved variables
    local env_from_file=$(env | grep -E '^[A-Z_][A-Z0-9_]*=' | grep -vE '^(RELEASE_VERSION|ENVIRONMENT|SENTRY_ENVIRONMENT|PREVIEW_BRANCH|NODE_ENV|PORT|PATH|HOME|USER|PWD|SHELL|TERM|LANG|LC_|GOOGLE_|GCLOUD_|BUILDER_|RESULTS|SHLVL|HOSTNAME|CLOUD_SDK_|OLDPWD|_|.*_API_KEY)' | sed 's/=/=/g' | tr '\n' ',' | sed 's/,$//')
    
    if [ -n "$env_from_file" ]; then
        env_vars="${env_vars},${env_from_file}"
    fi
    
    echo "$env_vars"
}

# Export the function so it can be used by sourcing scripts
export -f build_env_vars_string
