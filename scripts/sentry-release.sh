#!/bin/bash

# Sentry Release Management Script
# This script handles Sentry releases for local development and manual deployments

set -e

# Configuration
SENTRY_ORG="${SENTRY_ORG:-mento-labs}"
SENTRY_PROJECT="${SENTRY_PROJECT:-analytics-api}"
RELEASE_VERSION="${1:-$(git rev-parse HEAD)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Sentry release process...${NC}"
echo -e "Organization: ${SENTRY_ORG}"
echo -e "Project: ${SENTRY_PROJECT}"
echo -e "Release: ${RELEASE_VERSION}"

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# Check if SENTRY_AUTH_TOKEN is set
if [ -z "$SENTRY_AUTH_TOKEN" ]; then
    echo -e "${RED}Error: SENTRY_AUTH_TOKEN environment variable is not set${NC}"
    echo "Please add it to your .env file or set it by running: export SENTRY_AUTH_TOKEN=your-token"
    exit 1
fi

# Check if dist directory exists
if [ ! -d "./dist" ]; then
    echo -e "${YELLOW}Building project to generate source maps...${NC}"
    pnpm run build
fi

# Create a new release
echo -e "\n${GREEN}Creating new release...${NC}"
npx @sentry/cli releases new "$RELEASE_VERSION" \
    --org "$SENTRY_ORG" \
    --project "$SENTRY_PROJECT"

# Inject Debug IDs into source files
echo -e "\n${GREEN}Injecting Debug IDs into source files...${NC}"
npx @sentry/cli sourcemaps inject ./dist \
    --org "$SENTRY_ORG" \
    --project "$SENTRY_PROJECT"

# Upload source maps
echo -e "\n${GREEN}Uploading source maps...${NC}"
npx @sentry/cli sourcemaps upload ./dist \
    --org "$SENTRY_ORG" \
    --project "$SENTRY_PROJECT" \
    --release "$RELEASE_VERSION" \
    --validate

# Associate commits (if in a git repository)
if [ -d ".git" ]; then
    echo -e "\n${GREEN}Associating commits...${NC}"
    npx @sentry/cli releases set-commits "$RELEASE_VERSION" --auto \
        --org "$SENTRY_ORG" \
        --project "$SENTRY_PROJECT" || echo -e "${YELLOW}Warning: Could not associate commits${NC}"
fi

# Finalize the release
echo -e "\n${GREEN}Finalizing release...${NC}"
npx @sentry/cli releases finalize "$RELEASE_VERSION" \
    --org "$SENTRY_ORG" \
    --project "$SENTRY_PROJECT"

# Optional: Mark as deployed (for local testing)
if [ "$2" == "--deploy" ]; then
    ENV="${3:-development}"
    echo -e "\n${GREEN}Marking release as deployed to ${ENV}...${NC}"
    npx @sentry/cli releases deploys "$RELEASE_VERSION" new \
        --org "$SENTRY_ORG" \
        --project "$SENTRY_PROJECT" \
        --env "$ENV" \
        --name "Manual Deployment"
fi

# Clean up source maps (optional)
if [ "$CLEANUP_SOURCEMAPS" == "true" ]; then
    echo -e "\n${YELLOW}Cleaning up source maps...${NC}"
    find ./dist -name "*.map" -type f -delete
fi

echo -e "\n${GREEN}Sentry release process completed successfully!${NC}"
echo -e "Release ${RELEASE_VERSION} is now available in Sentry"
