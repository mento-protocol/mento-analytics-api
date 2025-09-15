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

check_secret_has_value() {
    local secret_name=$1
    
    echo -n "Checking if secret '$secret_name' has a value... "
    
    local version_count=$(gcloud secrets versions list "$secret_name" --project="$PROJECT_ID" --format="value(name)" | wc -l)
    
    if [ "$version_count" -gt 0 ]; then
        print_success "has value"
        return 0
    else
        print_warning "no value set"
        return 1
    fi
}

add_secret_value() {
    local secret_name=$1
    local value=$2
    local value_type=$3  # "real" or "placeholder"
    
    echo -n "Adding $value_type value to '$secret_name'... "
    
    if echo -n "$value" | gcloud secrets versions add "$secret_name" --data-file=- --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_success "$value_type added"
    else
        print_error "failed to add $value_type"
        return 1
    fi
}

prompt_for_api_key() {
    local service_name=$1
    local secret_name=$2
    local url=$3
    
    echo ""
    echo -e "${BLUE}$service_name API Key${NC}"
    echo "Get your API key from: $url"
    echo -n "Enter your API key (or press Enter to skip): "
    
    # Read without echoing to terminal for security
    read -s api_key
    echo  # Add newline since read -s doesn't
    
    if [ -n "$api_key" ]; then
        add_secret_value "$secret_name" "$api_key" "real API key"
        return 0
    else
        echo "Skipping real API key, will use placeholder..."
        add_secret_value "$secret_name" "preview-placeholder-$(echo $secret_name | cut -d'-' -f1)" "placeholder"
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
    NEEDS_CMC_VALUE=false
    NEEDS_ER_VALUE=false
    
    if create_secret_if_not_exists "coinmarketcap-api-key-preview"; then
        CREATED_CMC=true
    fi
    
    if create_secret_if_not_exists "exchange-rates-api-key-preview"; then
        CREATED_ER=true
    fi
    
    print_section "Granting Access"
    
    grant_access_to_default_sa "coinmarketcap-api-key-preview"
    grant_access_to_default_sa "exchange-rates-api-key-preview"
    
    print_section "Adding API Key Values"
    
    # Check if secrets need values and prompt for them
    if ! check_secret_has_value "coinmarketcap-api-key-preview"; then
        NEEDS_CMC_VALUE=true
    fi
    
    if ! check_secret_has_value "exchange-rates-api-key-preview"; then
        NEEDS_ER_VALUE=true
    fi
    
    # If secrets already have values, ask if user wants to update them
    if [ "$NEEDS_CMC_VALUE" = false ] && [ "$NEEDS_ER_VALUE" = false ]; then
        echo ""
        echo "Both secrets already have values."
        read -p "Do you want to update them with new API keys? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            NEEDS_CMC_VALUE=true
            NEEDS_ER_VALUE=true
        fi
    fi
    
    # Prompt for API keys if needed
    ADDED_REAL_CMC=false
    ADDED_REAL_ER=false
    
    if [ "$NEEDS_CMC_VALUE" = true ]; then
        if prompt_for_api_key "CoinMarketCap" "coinmarketcap-api-key-preview" "https://coinmarketcap.com/api/"; then
            ADDED_REAL_CMC=true
        fi
    fi
    
    if [ "$NEEDS_ER_VALUE" = true ]; then
        if prompt_for_api_key "Exchange Rates API" "exchange-rates-api-key-preview" "https://exchangeratesapi.io/"; then
            ADDED_REAL_ER=true
        fi
    fi
    
    print_section "Setup Summary"
    
    if [ "$NEEDS_CMC_VALUE" = true ] || [ "$NEEDS_ER_VALUE" = true ]; then
        echo "✅ All secrets now have values and deployments will work!"
        echo ""
        
        if [ "$ADDED_REAL_CMC" = true ] || [ "$ADDED_REAL_ER" = true ]; then
            echo "Real API keys added for:"
            [ "$ADDED_REAL_CMC" = true ] && echo "  - CoinMarketCap"
            [ "$ADDED_REAL_ER" = true ] && echo "  - Exchange Rates API"
        fi
        
        if [ "$ADDED_REAL_CMC" = false ] && [ "$NEEDS_CMC_VALUE" = true ]; then
            echo "Placeholder added for CoinMarketCap (API calls will fail)"
        fi
        
        if [ "$ADDED_REAL_ER" = false ] && [ "$NEEDS_ER_VALUE" = true ]; then
            echo "Placeholder added for Exchange Rates API (API calls will fail)"
        fi
        echo ""
        echo "To update any secret later:"
        echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add SECRET_NAME --data-file=- --project=$PROJECT_ID${NC}"
    else
        echo "All secrets already have values. To update them:"
        echo ""
        echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add coinmarketcap-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
        echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add exchange-rates-api-key-preview --data-file=- --project=$PROJECT_ID${NC}"
    fi
    
    print_section "Important Notes"
    
    echo "1. These secrets are shared by ALL preview deployments"
    echo "2. Placeholder values allow deployments to succeed (APIs will return errors)"
    echo "3. Use test/sandbox API keys for real functionality testing"
    echo "4. These are separate from production secrets"
    echo "5. Preview deployments will work automatically"
    echo ""
    
    print_success "Setup complete! Preview deployments can now deploy successfully."
}

# Run main function
main