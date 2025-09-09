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
    echo "  deploy <branch>          Deploy a preview for a specific branch"
    echo "  delete <branch>          Delete a preview deployment"
    echo "  cleanup-old [days]       Delete preview deployments older than N days (default: 7)"
    echo "  get-url <branch>         Get the URL for a preview deployment"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 deploy feature/new-api"
    echo "  $0 delete feature/old-api"
    echo "  $0 cleanup-old 14"
}

# Convert branch name to safe service name
get_safe_branch_name() {
    local branch=$1
    echo "$branch" | \
        sed 's/[^a-zA-Z0-9-]/-/g' | \
        tr '[:upper:]' '[:lower:]' | \
        sed 's/^-//;s/-$//' | \
        sed 's/--*/-/g' | \
        cut -c1-40
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
    if [ -z "$branch" ]; then
        echo -e "${RED}Error: Branch name required${NC}"
        print_usage
        exit 1
    fi
    
    echo -e "${BLUE}Deploying preview for branch: $branch${NC}"
    
    # Trigger the build
    gcloud builds submit \
        --config=cloudbuild-preview.yaml \
        --substitutions=BRANCH_NAME=$branch,SHORT_SHA=$(git rev-parse --short HEAD),COMMIT_SHA=$(git rev-parse HEAD) \
        --project=$PROJECT_ID
}

# Delete a preview deployment
delete_preview() {
    local branch=$1
    if [ -z "$branch" ]; then
        echo -e "${RED}Error: Branch name required${NC}"
        print_usage
        exit 1
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

# Get URL for a preview deployment
get_preview_url() {
    local branch=$1
    if [ -z "$branch" ]; then
        echo -e "${RED}Error: Branch name required${NC}"
        print_usage
        exit 1
    fi
    
    local safe_branch_name=$(get_safe_branch_name "$branch")
    local service_name="${SERVICE_PREFIX}-${safe_branch_name}"
    
    local url=$(gcloud run services describe "$service_name" \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID \
        --format='value(status.url)' 2>/dev/null || echo "")
    
    if [ -n "$url" ]; then
        echo -e "${GREEN}Preview URL for branch '$branch': $url${NC}"
    else
        echo -e "${RED}No preview deployment found for branch: $branch${NC}"
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
    get-url)
        get_preview_url "${2:-}"
        ;;
    cleanup-old)
        cleanup_old_previews "${2:-}"
        ;;
    *)
        print_usage
        exit 1
        ;;
esac
