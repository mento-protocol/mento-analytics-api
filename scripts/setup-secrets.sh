#!/bin/bash

# Unified setup script for all Mento Analytics API secrets
# This script creates and manages all secrets needed for preview and production deployments

set -euo pipefail

# Source shared utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/shared-utils.sh"

create_secret_if_not_exists() {
    local secret_name="$1"
    local description="$2"
    local labels="$3"
    
    echo -n "Checking if secret '$secret_name' exists... "
    
    if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_warning "already exists"
        return 0
    else
        echo "not found, creating..."
        
        # Create the secret
        gcloud secrets create "$secret_name" \
            --replication-policy="automatic" \
            --labels="$labels" \
            --project="$PROJECT_ID"
        
        print_success "Secret created: $secret_name"
        return 1
    fi
}

check_secret_has_value() {
    local secret_name="$1"
    
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
    local secret_name="$1"
    local value="$2"
    local value_type="$3"  # "real" or "placeholder"
    
    echo -n "Adding $value_type value to '$secret_name'... "
    
    if echo -n "$value" | gcloud secrets versions add "$secret_name" --data-file=- --project="$PROJECT_ID" >/dev/null 2>&1; then
        print_success "$value_type added"
    else
        print_error "failed to add $value_type"
        return 1
    fi
}

prompt_for_api_key() {
    local service_name="$1"
    local secret_name="$2"
    local url="$3"
    
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

prompt_for_rpc_url() {
    local network_name="$1"
    local secret_name="$2"
    local example_url="$3"
    
    echo ""
    echo -e "${BLUE}$network_name RPC URL${NC}"
    echo "Example: $example_url"
    echo -n "Enter your RPC URL with API key (or press Enter to skip): "
    
    # Read without echoing to terminal for security
    read -s rpc_url
    echo  # Add newline since read -s doesn't
    
    if [ -n "$rpc_url" ]; then
        add_secret_value "$secret_name" "$rpc_url" "real RPC URL"
        return 0
    else
        echo "Skipping real RPC URL, will use placeholder..."
        add_secret_value "$secret_name" "wss://placeholder-$network_name-rpc-url" "placeholder"
        return 1
    fi
}

grant_access_to_default_sa() {
    local secret_name="$1"
    
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

setup_api_keys() {
    local environment="$1"
    
    print_section "Setting up API Keys for $environment"
    
    # Create API key secrets
    CREATED_CMC=false
    CREATED_ER=false
    
    if create_secret_if_not_exists "coinmarketcap-api-key-$environment" "CoinMarketCap API key for $environment deployments" "purpose=api-keys,environment=$environment"; then
        CREATED_CMC=true
    fi
    
    if create_secret_if_not_exists "exchange-rates-api-key-$environment" "Exchange Rates API key for $environment deployments" "purpose=api-keys,environment=$environment"; then
        CREATED_ER=true
    fi
    
    # Grant access
    grant_access_to_default_sa "coinmarketcap-api-key-$environment"
    grant_access_to_default_sa "exchange-rates-api-key-$environment"
    
    # Check if secrets need values
    NEEDS_CMC_VALUE=false
    NEEDS_ER_VALUE=false
    
    if ! check_secret_has_value "coinmarketcap-api-key-$environment"; then
        NEEDS_CMC_VALUE=true
    fi
    
    if ! check_secret_has_value "exchange-rates-api-key-$environment"; then
        NEEDS_ER_VALUE=true
    fi
    
    # If secrets already have values, ask if user wants to update them
    if [ "$NEEDS_CMC_VALUE" = false ] && [ "$NEEDS_ER_VALUE" = false ]; then
        echo ""
        echo "Both API key secrets already have values."
        read -p "Do you want to update them with new API keys? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            NEEDS_CMC_VALUE=true
            NEEDS_ER_VALUE=true
        fi
    fi
    
    # Prompt for API keys if needed
    if [ "$NEEDS_CMC_VALUE" = true ]; then
        prompt_for_api_key "CoinMarketCap" "coinmarketcap-api-key-$environment" "https://coinmarketcap.com/api/"
    fi
    
    if [ "$NEEDS_ER_VALUE" = true ]; then
        prompt_for_api_key "Exchange Rates API" "exchange-rates-api-key-$environment" "https://exchangeratesapi.io/"
    fi
}

setup_rpc_urls() {
    local environment="$1"
    
    print_section "Setting up RPC URLs for $environment"
    
    # Create RPC URL secrets
    CREATED_CELO=false
    CREATED_ETH=false
    
    if create_secret_if_not_exists "celo-rpc-url-$environment" "Celo RPC URL for $environment deployments" "purpose=rpc-urls,environment=$environment"; then
        CREATED_CELO=true
    fi
    
    if create_secret_if_not_exists "eth-rpc-url-$environment" "Ethereum RPC URL for $environment deployments" "purpose=rpc-urls,environment=$environment"; then
        CREATED_ETH=true
    fi
    
    # Grant access
    grant_access_to_default_sa "celo-rpc-url-$environment"
    grant_access_to_default_sa "eth-rpc-url-$environment"
    
    # Check if secrets need values
    NEEDS_CELO_VALUE=false
    NEEDS_ETH_VALUE=false
    
    if ! check_secret_has_value "celo-rpc-url-$environment"; then
        NEEDS_CELO_VALUE=true
    fi
    
    if ! check_secret_has_value "eth-rpc-url-$environment"; then
        NEEDS_ETH_VALUE=true
    fi
    
    # If secrets already have values, ask if user wants to update them
    if [ "$NEEDS_CELO_VALUE" = false ] && [ "$NEEDS_ETH_VALUE" = false ]; then
        echo ""
        echo "Both RPC URL secrets already have values."
        read -p "Do you want to update them with new RPC URLs? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            NEEDS_CELO_VALUE=true
            NEEDS_ETH_VALUE=true
        fi
    fi
    
    # Prompt for RPC URLs if needed
    if [ "$NEEDS_CELO_VALUE" = true ]; then
        prompt_for_rpc_url "Celo" "celo-rpc-url-$environment" "wss://celo-mainnet.infura.io/ws/v3/YOUR_API_KEY"
    fi
    
    if [ "$NEEDS_ETH_VALUE" = true ]; then
        prompt_for_rpc_url "Ethereum" "eth-rpc-url-$environment" "wss://mainnet.infura.io/ws/v3/YOUR_API_KEY"
    fi
}

show_manual_commands() {
    local environment="$1"
    
    echo ""
    echo "To manually update secrets later:"
    echo ""
    echo -e "${YELLOW}# API Keys${NC}"
    echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add coinmarketcap-api-key-$environment --data-file=- --project=$PROJECT_ID${NC}"
    echo -e "${YELLOW}echo -n 'NEW_KEY' | gcloud secrets versions add exchange-rates-api-key-$environment --data-file=- --project=$PROJECT_ID${NC}"
    echo ""
    echo -e "${YELLOW}# RPC URLs${NC}"
    echo -e "${YELLOW}echo -n 'wss://your-celo-rpc-url' | gcloud secrets versions add celo-rpc-url-$environment --data-file=- --project=$PROJECT_ID${NC}"
    echo -e "${YELLOW}echo -n 'wss://your-eth-rpc-url' | gcloud secrets versions add eth-rpc-url-$environment --data-file=- --project=$PROJECT_ID${NC}"
}

main() {
    print_section "Mento Analytics API Secrets Setup"
    
    echo "This script creates and manages all secrets needed for deployments."
    echo ""
    echo "You'll need:"
    echo "- API keys for CoinMarketCap and Exchange Rates API"
    echo "- RPC URLs with API keys for Celo and Ethereum networks"
    echo ""
    echo "Project: $PROJECT_ID"
    echo ""
    
    # Check if we're authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        print_error "No active gcloud authentication found. Please run 'gcloud auth login' first."
        exit 1
    fi
    
    # Ask which environments to set up
    echo "Which environments would you like to set up?"
    echo "1) Preview only"
    echo "2) Production only"
    echo "3) Both preview and production"
    echo ""
    read -p "Enter your choice (1-3): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            ENVIRONMENTS=("preview")
            ;;
        2)
            ENVIRONMENTS=("prod")
            ;;
        3)
            ENVIRONMENTS=("preview" "prod")
            ;;
        *)
            print_error "Invalid choice. Exiting."
            exit 1
            ;;
    esac
    
    # Ask which types of secrets to set up
    echo ""
    echo "Which types of secrets would you like to set up?"
    echo "1) API Keys only"
    echo "2) RPC URLs only"
    echo "3) Both API Keys and RPC URLs"
    echo ""
    read -p "Enter your choice (1-3): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            SETUP_API_KEYS=true
            SETUP_RPC_URLS=false
            ;;
        2)
            SETUP_API_KEYS=false
            SETUP_RPC_URLS=true
            ;;
        3)
            SETUP_API_KEYS=true
            SETUP_RPC_URLS=true
            ;;
        *)
            print_error "Invalid choice. Exiting."
            exit 1
            ;;
    esac
    
    # Set up secrets for each environment
    for env in "${ENVIRONMENTS[@]}"; do
        print_section "Setting up $env environment"
        
        if [ "$SETUP_API_KEYS" = true ]; then
            setup_api_keys "$env"
        fi
        
        if [ "$SETUP_RPC_URLS" = true ]; then
            setup_rpc_urls "$env"
        fi
        
        show_manual_commands "$env"
    done
    
    print_section "Setup Complete"
    
    echo "✅ All requested secrets have been set up!"
    echo ""
    echo "Important notes:"
    echo "- Preview secrets are shared by ALL preview deployments"
    echo "- Production secrets are used only for production deployments"
    echo "- Placeholder values allow deployments to succeed (APIs will return errors)"
    echo "- Use test/sandbox API keys for real functionality testing"
    echo "- RPC URLs should include your API keys for better rate limits"
    echo ""
    
    print_success "Setup complete! Deployments can now use these secrets."
}

# Run main function
main "$@"
