#!/bin/bash

# Script for managing preview deployments
# Usage: ./scripts/preview-deployments.sh [command] [options]

set -euo pipefail

# Source shared utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/shared-utils.sh"

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


# List all preview deployments
list_previews() {
    print_info "Listing all preview deployments..."
    
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
            print_error "Could not determine current branch"
            print_usage
            exit 1
        fi
        
        print_warning "No branch specified. Current branch is: $branch"
        read -p "Deploy preview for current branch '$branch'? (y/N) " -n 1 -r
        echo
        
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Deploy cancelled"
            exit 0
        fi
    fi
    
    print_info "Deploying preview for branch: $branch"
    
    # Trigger the build
    local safe_branch_name=$(get_safe_branch_name "$branch")
    
    print_info "Submitting build and streaming logs..."
    
    # Submit build asynchronously to get build ID quickly
    local build_id=$(gcloud builds submit \
        --config=cloudbuild-preview.yaml \
        --substitutions=_BRANCH_NAME=$branch,_BRANCH_TAG=$safe_branch_name,_SHORT_SHA=$(git rev-parse --short HEAD),_COMMIT_SHA=$(git rev-parse HEAD) \
        --project=$PROJECT_ID \
        --async \
        --format='value(id)')
    
    if [ -n "$build_id" ]; then
        print_info "Build submitted with ID: $build_id"
        print_info "Streaming build logs..."
        
        # Try to use beta command for better log streaming, fall back to regular command
        if gcloud beta builds log "$build_id" --stream --project=$PROJECT_ID 2>/dev/null; then
            print_success "Build logs streamed successfully"
        else
            print_warning "Beta command unavailable, using regular log command..."
            # Install beta components if needed
            gcloud components install beta --quiet >/dev/null 2>&1 || true
            # Try beta command again, or use regular polling
            if ! gcloud beta builds log "$build_id" --stream --project=$PROJECT_ID 2>/dev/null; then
                print_warning "Falling back to status polling..."
                while true; do
                    status=$(gcloud builds describe "$build_id" --project=$PROJECT_ID --format="value(status)")
                    case "$status" in
                        "SUCCESS")
                            print_success "Build completed successfully"
                            break
                            ;;
                        "FAILURE"|"CANCELLED"|"TIMEOUT")
                            print_error "Build failed with status: $status"
                            exit 1
                            ;;
                        *)
                            print_info "Build status: $status"
                            sleep 10
                            ;;
                    esac
                done
            fi
        fi
    else
        print_error "Failed to get build ID"
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
            print_error "Could not determine current branch"
            print_usage
            exit 1
        fi
        
        print_warning "No branch specified. Current branch is: $branch"
        read -p "Delete preview for current branch '$branch'? (y/N) " -n 1 -r
        echo
        
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Delete cancelled"
            exit 0
        fi
    fi
    
    local service_name=$(get_preview_service_name "$branch")
    
    print_warning "Deleting preview deployment: $service_name"
    
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
        
        print_success "Successfully deleted preview deployment: $service_name"
    else
        print_warning "Preview deployment not found: $service_name"
    fi
}

# Cleanup old preview deployments
cleanup_old_previews() {
    local days=${1:-7}
    local cutoff_date=$(date -d "$days days ago" +%Y-%m-%d 2>/dev/null || date -v -${days}d +%Y-%m-%d)
    
    print_info "Cleaning up preview deployments older than $days days (before $cutoff_date)..."
    
    # Get list of old services
    local old_services=$(gcloud run services list \
        --platform=managed \
        --region=$REGION \
        --project=$PROJECT_ID \
        --filter="metadata.labels.managed-by:preview-deployments AND metadata.creationTimestamp<$cutoff_date" \
        --format="value(name)")
    
    if [ -z "$old_services" ]; then
        print_success "No old preview deployments found"
        return
    fi
    
    print_warning "Found the following old preview deployments:"
    echo "$old_services"
    echo ""
    
    read -p "Do you want to delete these deployments? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for service in $old_services; do
            print_warning "Deleting: $service"
            gcloud run services delete "$service" \
                --platform=managed \
                --region=$REGION \
                --project=$PROJECT_ID \
                --quiet
        done
        print_success "Cleanup completed"
    else
        print_warning "Cleanup cancelled"
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
