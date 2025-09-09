#!/bin/bash

# One-time setup script for preview deployment secrets
# This creates preview-specific secrets that will be shared by all preview deployments

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-mento-prod}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

create_secret_if_not_exists() {
    local secret_name=$1
    
    echo -n "Checking if secret '$secret_name' exists... "
    
    if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "already exists"
        return 0
    else
        echo "not found, creating..."
        
        # Create the secret
        gcloud secrets create "$secret_name" \
            --replication-policy="automatic" \
            --labels="purpose=preview-deployments" \
            --project="$PROJECT_ID"
        
        print_success "Secret created: $secret_name"
        return 1
    fi
}

grant_access_to_default_sa() {
    local secret_name=$1
    
    # Get the default compute service account
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
    COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    
    echo -n "Granting access to default compute service account... "
    
    if gcloud secrets add-iam-policy-binding "$secret_name" \
        --member="serviceAccount:$COMPUTE_SA" \
        --role="roles/secretmanager.secretAccessor" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_success "granted"
    else
        print_warning "may already have access"
    fi
}

main() {
    print_section "One-Time Setup for Preview Deployment Secrets"
    
    echo "This script creates preview-specific secrets that will be shared"
    echo "by ALL preview deployments. This is a one-time setup."
    echo ""
    echo "You'll need:"
    echo "- Test/sandbox API keys for CoinMarketCap"
    echo "- Test/sandbox API keys for Exchange Rates API"
    echo ""
    echo "Project: $PROJECT_ID"
    echo ""
    
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled"
        exit 0
    fi
    
    print_section "Creating Preview Secrets"
    
    # Create secrets
    CREATED_CMC=false
    CREATED_ER=false
    
    if create_secret_if_not_exists "coinmarketcap-api-key-preview"; then
        CREATED_CMC=true
    fi
    
    if create_secret_if_not_exists "exchange-rates-api-key-preview"; then
        CREATED_ER=true
    fi
    
    print_section "Granting Access"
    
    grant_access_to_default_sa "coinmarketcap-api-key-preview"
    grant_access_to_default_sa "exchange-rates-api-key-preview"
    
    print_section "Add API Key Values"
    
    if [ "$CREATED_CMC" = true ] || [ "$CREATED_ER" = true ]; then
        echo "Now add your test/sandbox API keys:"
        echo ""
        
        if [ "$CREATED_CMC" = true ]; then
            echo "For CoinMarketCap (get a free sandbox key from https://coinmarketcap.com/api/):"
            echo -e "${YELLOW}echo -n 'YOUR_SANDBOX_KEY' | gcloud secrets versions add coinmarketcap-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
            echo ""
        fi
        
        if [ "$CREATED_ER" = true ]; then
            echo "For Exchange Rates (get a free tier key from https://exchangeratesapi.io/):"
            echo -e "${YELLOW}echo -n 'YOUR_TEST_KEY' | gcloud secrets versions add exchange-rates-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
            echo ""
        fi
    else
        echo "Secrets already exist. To update the values:"
        echo ""
        echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add coinmarketcap-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
        echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add exchange-rates-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
    fi
    
    print_section "Important Notes"
    
    echo "1. These secrets are shared by ALL preview deployments"
    echo "2. Use test/sandbox API keys with appropriate rate limits"
    echo "3. These are separate from production secrets"
    echo "4. Once set up, preview deployments will work automatically"
    echo ""
    
    print_success "Setup complete! Preview deployments will use these secrets automatically."
}

# Run main function
main