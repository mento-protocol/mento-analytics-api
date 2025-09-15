#!/bin/bash

# Setup script for configuring preview deployments in Google Cloud
# This script automates the creation of necessary GCP resources and GitHub integration

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-mento-prod}"
REGION="${GCP_REGION:-us-central1}"
GITHUB_REPO_OWNER="${GITHUB_REPO_OWNER:-}"
GITHUB_REPO_NAME="${GITHUB_REPO_NAME:-mento-analytics-api}"
SERVICE_ACCOUNT_NAME="github-preview-deployments"
WIF_POOL_NAME="github-actions-pool"
WIF_PROVIDER_NAME="github-provider"

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

check_prerequisites() {
    print_section "Checking Prerequisites"
    
    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed. Please install it first:"
        echo "https://cloud.google.com/sdk/docs/install"
        exit 1
    fi
    
    # Check if user is authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
        print_error "You are not authenticated with gcloud. Please run:"
        echo "gcloud auth login"
        exit 1
    fi
    
    # Check if GitHub CLI is installed (optional but helpful)
    if command -v gh &> /dev/null; then
        GH_CLI_AVAILABLE=true
        print_success "GitHub CLI found"
    else
        GH_CLI_AVAILABLE=false
        print_warning "GitHub CLI not found. You'll need to add secrets manually."
    fi
    
    print_success "Prerequisites check completed"
}

get_project_info() {
    print_section "Project Configuration"
    
    # Get current project
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
    
    if [ -z "$CURRENT_PROJECT" ]; then
        echo "No default project set. Available projects:"
        gcloud projects list --format="table(projectId,name)"
        echo ""
    fi
    
    read -p "Enter GCP Project ID (default: $PROJECT_ID): " input
    PROJECT_ID="${input:-$PROJECT_ID}"
    
    # Set project
    gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
    
    # Get project number
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
    
    print_success "Using project: $PROJECT_ID (number: $PROJECT_NUMBER)"
}

get_github_info() {
    print_section "GitHub Repository Information"
    
    # Try to get from git remote if not provided
    if [ -z "$GITHUB_REPO_OWNER" ] && command -v git &> /dev/null; then
        REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
        if [[ $REMOTE_URL =~ github.com[:/]([^/]+)/([^/.]+) ]]; then
            GITHUB_REPO_OWNER="${BASH_REMATCH[1]}"
            GITHUB_REPO_NAME="${BASH_REMATCH[2]}"
        fi
    fi
    
    read -p "Enter GitHub repository owner/organization (default: $GITHUB_REPO_OWNER): " input
    GITHUB_REPO_OWNER="${input:-$GITHUB_REPO_OWNER}"
    
    read -p "Enter GitHub repository name (default: $GITHUB_REPO_NAME): " input
    GITHUB_REPO_NAME="${input:-$GITHUB_REPO_NAME}"
    
    if [ -z "$GITHUB_REPO_OWNER" ] || [ -z "$GITHUB_REPO_NAME" ]; then
        print_error "GitHub repository information is required"
        exit 1
    fi
    
    print_success "GitHub repository: $GITHUB_REPO_OWNER/$GITHUB_REPO_NAME"
}

enable_apis() {
    print_section "Enabling Required APIs"
    
    REQUIRED_APIS=(
        "cloudbuild.googleapis.com"
        "run.googleapis.com"
        "artifactregistry.googleapis.com"
        "iam.googleapis.com"
        "iamcredentials.googleapis.com"
        "cloudresourcemanager.googleapis.com"
        "sts.googleapis.com"
    )
    
    for api in "${REQUIRED_APIS[@]}"; do
        echo -n "Enabling $api... "
        if gcloud services enable "$api" --project="$PROJECT_ID" >/dev/null 2>&1; then
            print_success "enabled"
        else
            print_warning "may already be enabled"
        fi
    done
}

create_service_account() {
    print_section "Creating Service Account"
    
    SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    
    # Check if service account exists
    if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "Service account already exists: $SA_EMAIL"
    else
        echo "Creating service account..."
        gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
            --display-name="GitHub Actions Preview Deployments" \
            --description="Service account for GitHub Actions to deploy preview environments" \
            --project="$PROJECT_ID"
        print_success "Service account created: $SA_EMAIL"
    fi
    
    # Grant necessary roles
    print_section "Granting IAM Roles"
    
    REQUIRED_ROLES=(
        "roles/cloudbuild.builds.builder"
        "roles/run.admin"
        "roles/artifactregistry.writer"
        "roles/logging.logWriter"
        "roles/iam.serviceAccountUser"
    )
    
    for role in "${REQUIRED_ROLES[@]}"; do
        echo -n "Granting $role... "
        if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:$SA_EMAIL" \
            --role="$role" \
            --condition=None >/dev/null 2>&1; then
            print_success "granted"
        else
            print_warning "may already be granted"
        fi
    done
}

setup_workload_identity() {
    print_section "Setting up Workload Identity Federation"
    
    # Create workload identity pool
    echo "Creating Workload Identity Pool..."
    if gcloud iam workload-identity-pools describe "$WIF_POOL_NAME" \
        --location="global" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "Workload Identity Pool already exists"
    else
        gcloud iam workload-identity-pools create "$WIF_POOL_NAME" \
            --location="global" \
            --description="Pool for GitHub Actions" \
            --display-name="GitHub Actions Pool" \
            --project="$PROJECT_ID"
        print_success "Workload Identity Pool created"
    fi
    
    # Create workload identity provider
    echo "Creating Workload Identity Provider..."
    if gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_NAME" \
        --location="global" \
        --workload-identity-pool="$WIF_POOL_NAME" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "Workload Identity Provider already exists"
    else
        gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_NAME" \
            --location="global" \
            --workload-identity-pool="$WIF_POOL_NAME" \
            --issuer-uri="https://token.actions.githubusercontent.com" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
            --attribute-condition="assertion.repository_owner == '${GITHUB_REPO_OWNER}'" \
            --project="$PROJECT_ID"
        print_success "Workload Identity Provider created"
    fi
    
    # Grant service account access
    echo "Configuring service account access..."
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_NAME}/attribute.repository/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}" \
        --project="$PROJECT_ID" >/dev/null 2>&1
    
    print_success "Workload Identity Federation configured"
}

create_artifact_registry() {
    print_section "Creating Artifact Registry Repository"
    
    AR_REPOSITORY="cloud-run-source-deploy"
    
    # Check if repository exists
    if gcloud artifacts repositories describe "$AR_REPOSITORY" \
        --location="$REGION" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "Artifact Registry repository already exists"
    else
        echo "Creating Artifact Registry repository..."
        gcloud artifacts repositories create "$AR_REPOSITORY" \
            --location="$REGION" \
            --repository-format="docker" \
            --description="Docker repository for Cloud Run deployments" \
            --project="$PROJECT_ID"
        print_success "Artifact Registry repository created"
    fi
}

generate_github_secrets() {
    print_section "GitHub Secrets Configuration"
    
    WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_NAME}/providers/${WIF_PROVIDER_NAME}"
    
    echo "Add these secrets to your GitHub repository:"
    echo ""
    echo -e "${YELLOW}WIF_PROVIDER:${NC}"
    echo "$WIF_PROVIDER"
    echo ""
    echo -e "${YELLOW}WIF_SERVICE_ACCOUNT:${NC}"
    echo "$SA_EMAIL"
    echo ""
   
    # If GitHub CLI is available, offer to set secrets
    if [ "$GH_CLI_AVAILABLE" = true ]; then
        echo ""
        read -p "Would you like to set these secrets using GitHub CLI? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "Setting GitHub secrets..."
            
            cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
            
            gh secret set WIF_PROVIDER --body="$WIF_PROVIDER"
            gh secret set WIF_SERVICE_ACCOUNT --body="$SA_EMAIL"
            
            print_success "GitHub secrets configured"
        fi
    else
        echo ""
        echo "To add these secrets manually:"
        echo "1. Go to: https://github.com/$GITHUB_REPO_OWNER/$GITHUB_REPO_NAME/settings/secrets/actions"
        echo "2. Click 'New repository secret' for each secret above"
    fi
}

verify_setup() {
    print_section "Verification"
    
    echo "Checking service account..."
    if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_success "Service account exists"
    else
        print_error "Service account not found"
    fi
    
    echo "Checking Workload Identity Pool..."
    if gcloud iam workload-identity-pools describe "$WIF_POOL_NAME" \
        --location="global" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_success "Workload Identity Pool exists"
    else
        print_error "Workload Identity Pool not found"
    fi
    
    echo "Checking APIs..."
    ENABLED_APIS=$(gcloud services list --enabled --project="$PROJECT_ID" --format="value(name)")
    if echo "$ENABLED_APIS" | grep -q "cloudbuild.googleapis.com"; then
        print_success "Required APIs are enabled"
    else
        print_warning "Some APIs might not be enabled"
    fi
}

print_next_steps() {
    print_section "Next Steps"
    
    echo "1. If you haven't already, add the GitHub secrets to your repository:"
    echo "   - WIF_PROVIDER"
    echo "   - WIF_SERVICE_ACCOUNT"
    echo ""
    echo "2. Commit and push the preview deployment files to your repository"
    echo ""
    echo "3. Create a pull request or push to a feature branch to test"
    echo ""
    echo "4. Monitor the deployment:"
    echo "   - GitHub Actions: https://github.com/$GITHUB_REPO_OWNER/$GITHUB_REPO_NAME/actions"
    echo "   - Cloud Build: https://console.cloud.google.com/cloud-build/builds?project=$PROJECT_ID"
    echo "   - Cloud Run: https://console.cloud.google.com/run?project=$PROJECT_ID"
    echo ""
    print_success "Setup complete!"
}

# Main execution
main() {
    echo -e "${BLUE}Preview Deployments Setup Script${NC}"
    echo "This script will configure Google Cloud resources for GitHub Actions preview deployments"
    echo ""
    
    check_prerequisites
    get_project_info
    get_github_info
    
    echo ""
    echo "Configuration Summary:"
    echo "- Project ID: $PROJECT_ID"
    echo "- Region: $REGION"
    echo "- GitHub Repository: $GITHUB_REPO_OWNER/$GITHUB_REPO_NAME"
    echo "- Service Account: ${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    echo ""
    
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled"
        exit 0
    fi
    
    enable_apis
    create_service_account
    setup_workload_identity
    create_artifact_registry
    generate_github_secrets
    verify_setup
    print_next_steps
}

# Run main function
main
