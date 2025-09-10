#!/bin/bash

# Script for managing preview deployments
# Usage: ./scripts/preview-deployments.sh [command] [options]

set -euo pipefail

# Configuration
PROJECT_ID="mento-prod"
REGION="us-central1"
SERVICE_PREFIX="analytics-api-preview"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  list                     List all preview deployments"
    echo "  deploy [branch]          Deploy a preview for a branch (defaults to current branch)"
    echo "  delete [branch]          Delete a preview deployment (defaults to current branch)"
    echo "  cleanup-old [days]       Delete preview deployments older than N days (default: 7)"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 deploy                # Deploy current branch"
    echo "  $0 deploy feature/new-api"
    echo "  $0 delete                # Delete current branch preview"
    echo "  $0 delete feature/old-api"
    echo "  $0 cleanup-old 14"
}

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

# List all preview deployments
list_previews() {
    echo -e "${BLUE}Listing all preview deployments...${NC}"
    
    gcloud run services list \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID \
        --filter="metadata.labels.managed-by:preview-deployments" \
        --format="table(
            name:label='SERVICE NAME',
            status.url:label='URL',
            metadata.labels.branch:label='BRANCH',
            metadata.creationTimestamp.date('%Y-%m-%d %H:%M'):label='CREATED'
        )"
}

# Deploy a preview for a branch
deploy_preview() {
    local branch=$1
    
    # If no branch provided, use current branch with confirmation
    if [ -z "$branch" ]; then
        branch=$(get_current_branch)
        if [ -z "$branch" ]; then
            echo -e "${RED}Error: Could not determine current branch${NC}"
            print_usage
            exit 1
        fi
        
        echo -e "${YELLOW}No branch specified. Current branch is: $branch${NC}"
        read -p "Deploy preview for current branch '$branch'? (y/N) " -n 1 -r
        echo
        
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Deploy cancelled${NC}"
            exit 0
        fi
    fi
    
    echo -e "${BLUE}Deploying preview for branch: $branch${NC}"
    
    # Trigger the build
    local safe_branch_name=$(get_safe_branch_name "$branch")
    
    echo -e "${BLUE}Submitting build and streaming logs...${NC}"
    
    # Submit build asynchronously to get build ID quickly
    local build_id=$(gcloud builds submit \
        --config=cloudbuild-preview.yaml \
        --substitutions=_BRANCH_NAME=$branch,_BRANCH_TAG=$safe_branch_name,_SHORT_SHA=$(git rev-parse --short HEAD),_COMMIT_SHA=$(git rev-parse HEAD) \
        --project=$PROJECT_ID \
        --async \
        --format='value(id)')
    
    if [ -n "$build_id" ]; then
        echo -e "${BLUE}Build submitted with ID: $build_id${NC}"
        echo -e "${BLUE}Streaming build logs...${NC}"
        
        # Try to use beta command for better log streaming, fall back to regular command
        if gcloud beta builds log "$build_id" --stream --project=$PROJECT_ID 2>/dev/null; then
            echo -e "${GREEN}Build logs streamed successfully${NC}"
        else
            echo -e "${YELLOW}Beta command unavailable, using regular log command...${NC}"
            # Install beta components if needed
            gcloud components install beta --quiet >/dev/null 2>&1 || true
            # Try beta command again, or use regular polling
            if ! gcloud beta builds log "$build_id" --stream --project=$PROJECT_ID 2>/dev/null; then
                echo -e "${YELLOW}Falling back to status polling...${NC}"
                while true; do
                    status=$(gcloud builds describe "$build_id" --project=$PROJECT_ID --format="value(status)")
                    case "$status" in
                        "SUCCESS")
                            echo -e "${GREEN}Build completed successfully${NC}"
                            break
                            ;;
                        "FAILURE"|"CANCELLED"|"TIMEOUT")
                            echo -e "${RED}Build failed with status: $status${NC}"
                            exit 1
                            ;;
                        *)
                            echo -e "${BLUE}Build status: $status${NC}"
                            sleep 10
                            ;;
                    esac
                done
            fi
        fi
    else
        echo -e "${RED}Failed to get build ID${NC}"
        exit 1
    fi
}

# Delete a preview deployment
delete_preview() {
    local branch=$1
    
    # If no branch provided, use current branch with confirmation
    if [ -z "$branch" ]; then
        branch=$(get_current_branch)
        if [ -z "$branch" ]; then
            echo -e "${RED}Error: Could not determine current branch${NC}"
            print_usage
            exit 1
        fi
        
        echo -e "${YELLOW}No branch specified. Current branch is: $branch${NC}"
        read -p "Delete preview for current branch '$branch'? (y/N) " -n 1 -r
        echo
        
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Delete cancelled${NC}"
            exit 0
        fi
    fi
    
    local safe_branch_name=$(get_safe_branch_name "$branch")
    local service_name="${SERVICE_PREFIX}-${safe_branch_name}"
    
    echo -e "${YELLOW}Deleting preview deployment: $service_name${NC}"
    
    # Check if service exists
    if gcloud run services describe "$service_name" \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID >/dev/null 2>&1; then
        
        gcloud run services delete "$service_name" \
            --platform=managed \
            --region=$REGION \
            --project=$PROJECT_ID \
            --quiet
        
        echo -e "${GREEN}Successfully deleted preview deployment: $service_name${NC}"
    else
        echo -e "${YELLOW}Preview deployment not found: $service_name${NC}"
    fi
}

# Cleanup old preview deployments
cleanup_old_previews() {
    local days=${1:-7}
    local cutoff_date=$(date -d "$days days ago" +%Y-%m-%d 2>/dev/null || date -v -${days}d +%Y-%m-%d)
    
    echo -e "${BLUE}Cleaning up preview deployments older than $days days (before $cutoff_date)...${NC}"
    
    # Get list of old services
    local old_services=$(gcloud run services list \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID \
        --filter="metadata.labels.managed-by:preview-deployments AND metadata.creationTimestamp<$cutoff_date" \
        --format="value(name)")
    
    if [ -z "$old_services" ]; then
        echo -e "${GREEN}No old preview deployments found${NC}"
        return
    fi
    
    echo -e "${YELLOW}Found the following old preview deployments:${NC}"
    echo "$old_services"
    echo ""
    
    read -p "Do you want to delete these deployments? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for service in $old_services; do
            echo -e "${YELLOW}Deleting: $service${NC}"
            gcloud run services delete "$service" \
                --platform=managed \
                --region=$REGION \
                --project=$PROJECT_ID \
                --quiet
        done
        echo -e "${GREEN}Cleanup completed${NC}"
    else
        echo -e "${YELLOW}Cleanup cancelled${NC}"
    fi
}

# Main script logic
case "${1:-}" in
    list)
        list_previews
        ;;
    deploy)
        deploy_preview "${2:-}"
        ;;
    delete)
        delete_preview "${2:-}"
        ;;
    cleanup-old)
        cleanup_old_previews "${2:-}"
        ;;
    *)
        print_usage
        exit 1
        ;;
esac
