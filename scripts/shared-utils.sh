#!/bin/bash

# Shared utilities for preview deployment and logging scripts
# This script contains common functions used across multiple scripts

# Configuration constants
readonly PROJECT_ID="mento-prod"
readonly REGION="us-central1"
readonly MAIN_SERVICE_NAME="mento-analytics-api"
readonly PREVIEW_SERVICE_PREFIX="analytics-api-preview"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Get current git branch
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# Convert branch name to safe service name
# Prefix 'analytics-api-preview-' is 22 chars, leaving 41 chars for branch name
get_safe_branch_name() {
    local branch=$1
    echo "$branch" | \
        sed 's/[^a-zA-Z0-9-]/-/g' | \
        tr '[:upper:]' '[:lower:]' | \
        sed 's/^-//;s/-$//' | \
        sed 's/--*/-/g' | \
        cut -c1-41
}

# Generate preview service name from branch
get_preview_service_name() {
    local branch=$1
    local safe_branch_name=$(get_safe_branch_name "$branch")
    echo "${PREVIEW_SERVICE_PREFIX}-${safe_branch_name}"
}

# Check if a preview service exists for the given branch
check_preview_service_exists() {
    local branch=$1
    local preview_service_name=$(get_preview_service_name "$branch")
    
    gcloud run services describe "$preview_service_name" \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID >/dev/null 2>&1
}

# Get the appropriate service name for the current branch
# Returns main service for main/master branches, preview service if exists, otherwise main service
get_target_service_name() {
    local current_branch=$(get_current_branch)
    
    # If we're on main/master branch, use the main service
    if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
        echo "$MAIN_SERVICE_NAME"
        return
    fi
    
    # If no branch detected, default to main service
    if [[ -z "$current_branch" ]]; then
        echo -e "${YELLOW}Warning: Could not detect current branch, using main service${NC}" >&2
        echo "$MAIN_SERVICE_NAME"
        return
    fi
    
    # Check if preview service exists for current branch
    if check_preview_service_exists "$current_branch"; then
        echo "$(get_preview_service_name "$current_branch")"
    else
        echo -e "${YELLOW}No preview deployment found for branch '$current_branch', using main service${NC}" >&2
        echo "$MAIN_SERVICE_NAME"
    fi
}

# Print colored output
print_info() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_warning() {
    echo -e "${YELLOW}$1${NC}"
}

print_error() {
    echo -e "${RED}$1${NC}"
}

print_section() {
    echo ""
    echo -e "${BLUE}==== $1 ====${NC}"
    echo ""
}