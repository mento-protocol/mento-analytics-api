#!/bin/bash

# Admin setup script for preview deployments
# This script should be run by a Project Owner or someone with IAM Admin permissions
# It will grant the necessary permissions to set up Workload Identity Federation

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-mento-prod}"
USER_EMAIL="${USER_EMAIL:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_section() {
    echo ""
    echo -e "${BLUE}==== $1 ====${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

check_permissions() {
    print_section "Checking Current Permissions"
    
    # Get current user
    CURRENT_USER=$(gcloud config get-value account 2>/dev/null || echo "")
    
    if [ -z "$CURRENT_USER" ]; then
        print_error "No active gcloud account found. Please run: gcloud auth login"
        exit 1
    fi
    
    echo "Current user: $CURRENT_USER"
    
    # Check if user has owner role
    if gcloud projects get-iam-policy "$PROJECT_ID" \
        --flatten="bindings[].members" \
        --filter="bindings.members:user:$CURRENT_USER AND bindings.role:roles/owner" \
        --format="value(bindings.role)" | grep -q "roles/owner"; then
        print_success "You have Project Owner permissions"
        return 0
    else
        print_warning "You don't have Project Owner permissions"
        return 1
    fi
}

grant_permissions() {
    print_section "Granting Required Permissions"
    
    if [ -z "$USER_EMAIL" ]; then
        read -p "Enter the email of the user who needs permissions: " USER_EMAIL
    fi
    
    echo "Granting permissions to: $USER_EMAIL"
    
    # Required roles for setting up Workload Identity Federation
    REQUIRED_ROLES=(
        "roles/iam.workloadIdentityPoolAdmin"
        "roles/iam.serviceAccountAdmin"
        "roles/iam.serviceAccountKeyAdmin"
        "roles/serviceusage.serviceUsageAdmin"
        "roles/resourcemanager.projectIamAdmin"
    )
    
    for role in "${REQUIRED_ROLES[@]}"; do
        echo -n "Granting $role... "
        if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="user:$USER_EMAIL" \
            --role="$role" \
            --condition=None >/dev/null 2>&1; then
            print_success "granted"
        else
            print_warning "failed (may already exist)"
        fi
    done
    
    print_success "Permissions granted to $USER_EMAIL"
}

create_wif_as_owner() {
    print_section "Creating Workload Identity Federation Resources"
    
    echo "This script will create the Workload Identity resources as the Project Owner."
    echo ""
    
    # Get GitHub info
    read -p "Enter GitHub repository owner/organization: " GITHUB_ORG
    read -p "Enter GitHub repository name (default: mento-analytics-api): " GITHUB_REPO
    GITHUB_REPO="${GITHUB_REPO:-mento-analytics-api}"
    
    # Create resources
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
    WIF_POOL_NAME="github-actions-pool"
    WIF_PROVIDER_NAME="github-provider"
    SERVICE_ACCOUNT_NAME="github-preview-deployments"
    SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    
    # Create service account
    echo "Creating service account..."
    if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
        gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
            --display-name="GitHub Actions Preview Deployments" \
            --description="Service account for GitHub Actions to deploy preview environments" \
            --project="$PROJECT_ID"
    fi
    
    # Create workload identity pool
    echo "Creating Workload Identity Pool..."
    if ! gcloud iam workload-identity-pools describe "$WIF_POOL_NAME" \
        --location="global" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        gcloud iam workload-identity-pools create "$WIF_POOL_NAME" \
            --location="global" \
            --description="Pool for GitHub Actions" \
            --display-name="GitHub Actions Pool" \
            --project="$PROJECT_ID"
    fi
    
    # Create workload identity provider
    echo "Creating Workload Identity Provider..."
    if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_NAME" \
        --location="global" \
        --workload-identity-pool="$WIF_POOL_NAME" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_NAME" \
            --location="global" \
            --workload-identity-pool="$WIF_POOL_NAME" \
            --issuer-uri="https://token.actions.githubusercontent.com" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
            --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'" \
            --project="$PROJECT_ID"
    fi
    
    # Grant service account access
    echo "Configuring service account access..."
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_NAME}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
        --project="$PROJECT_ID"
    
    # Grant service account roles
    echo "Granting service account roles..."
    REQUIRED_ROLES=(
        "roles/cloudbuild.builds.builder"
        "roles/run.admin"
        "roles/artifactregistry.writer"
        "roles/logging.logWriter"
        "roles/iam.serviceAccountUser"
    )
    
    for role in "${REQUIRED_ROLES[@]}"; do
        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:$SA_EMAIL" \
            --role="$role" \
            --condition=None >/dev/null 2>&1
    done
    
    print_section "GitHub Secrets"
    
    WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_NAME}/providers/${WIF_PROVIDER_NAME}"
    
    echo -e "${YELLOW}WIF_PROVIDER:${NC}"
    echo "$WIF_PROVIDER"
    echo ""
    echo -e "${YELLOW}WIF_SERVICE_ACCOUNT:${NC}"
    echo "$SA_EMAIL"
    echo ""
    
    print_success "Setup complete!"
}

print_instructions() {
    print_section "Instructions"
    
    echo "You have two options to proceed:"
    echo ""
    echo "1. If you ARE a Project Owner:"
    echo "   - Choose option 1 to create the resources directly"
    echo ""
    echo "2. If you ARE NOT a Project Owner:"
    echo "   - Choose option 2 to grant yourself permissions (requires Project Owner to run this)"
    echo "   - Then run the regular setup script: ./scripts/setup-preview-deployments.sh"
    echo ""
    echo "3. Alternative: Ask a Project Owner to run this script for you"
}

# Main execution
main() {
    echo -e "${BLUE}Preview Deployments Admin Setup Script${NC}"
    echo "This script helps resolve permission issues when setting up preview deployments"
    echo ""
    
    # Set project
    gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
    
    if check_permissions; then
        echo ""
        echo "You have the necessary permissions. Choose an option:"
        echo "1. Create Workload Identity resources directly"
        echo "2. Grant permissions to another user"
        echo "3. Exit"
        echo ""
        read -p "Enter your choice (1-3): " choice
        
        case $choice in
            1)
                create_wif_as_owner
                ;;
            2)
                grant_permissions
                ;;
            3)
                echo "Exiting..."
                exit 0
                ;;
            *)
                print_error "Invalid choice"
                exit 1
                ;;
        esac
    else
        print_instructions
        echo ""
        echo "This script needs to be run by a Project Owner to grant you permissions."
        echo ""
        read -p "Are you running this as a Project Owner? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            USER_EMAIL="$CURRENT_USER"
            grant_permissions
            echo ""
            echo "Now you can run: ./scripts/setup-preview-deployments.sh"
        else
            echo ""
            echo "Please ask a Project Owner to run this script and choose option 2"
            echo "to grant you the necessary permissions."
        fi
    fi
}

# Run main function
main
