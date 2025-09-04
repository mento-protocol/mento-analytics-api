# Sentry Releases Integration

This document describes how Sentry releases are integrated into the Mento Analytics API deployment workflow.

## Overview

The integration provides:

- Source maps for better error stack traces
- Release tracking for issue resolution
- Deployment tracking
- Automatic issue resolution when fixes are deployed

## Setup Requirements

### 1. Google Cloud Secret Manager (Production)

For production deployments via Cloud Build, create a secret for the Sentry auth token:

```bash
# Load $SENTRY_AUTH_TOKEN into shell context
set -a; source .env; set +a;

# Create secret in google secret manager
echo -n $SENTRY_AUTH_TOKEN | gcloud secrets create sentry-auth-token --data-file=- --project=mento-prod
```

Grant the Cloud Build service account access to the secret:

```bash
# FYI you will need the secretmanager.admin role for this command to work
gcloud secrets add-iam-policy-binding sentry-auth-token \
  --member="serviceAccount:$(gcloud projects describe mento-prod --format="value(projectNumber)")@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=mento-prod
```

### 2. Local Development Configuration

For local development and testing, create a `.env` file in your project root:

```bash
# Copy the example file
cp .env.example .env

# Add your Sentry auth token
SENTRY_AUTH_TOKEN=your-sentry-auth-token-here
```

**Note**: The `.env` file is gitignored and should NOT be committed. It's only for local development.

### 3. Sentry Configuration

Ensure your Sentry project has [Repository integration enabled](https://mento-labs.sentry.io/settings/integrations/github/) (for commit tracking)

### 4. Local Development

For local testing of Sentry releases:

```bash
# Load $SENTRY_AUTH_TOKEN into shell context
set -a; source .env; set +a;

# Create a release manually
pnpm run sentry:release

# Create and deploy a release
pnpm run sentry:release:deploy
```

## How It Works

### 1. Build Process (cloudbuild.yaml)

The Cloud Build configuration:

1. Builds the Docker image with the commit SHA as the release version
2. Creates a Sentry release using the commit SHA
3. Uploads source maps to Sentry
4. Associates commits with the release (if repo integration is configured)
5. Deploys to Cloud Run with the RELEASE_VERSION environment variable
6. Marks the deployment in Sentry

### 2. Runtime Configuration

The application includes the release version in all Sentry events:

- Set via `RELEASE_VERSION` environment variable
- Defaults to 'unknown' if not provided
- Included in the Sentry SDK initialization

### 3. Source Maps

Source maps are:

- Generated during the TypeScript build process
- Uploaded to Sentry during deployment
- Deleted from the production image to prevent exposure
- Associated with the specific release for accurate stack traces

## Release Versioning

Releases use the Git commit SHA as the version identifier:

- Ensures uniqueness across deployments
- Allows tracing issues to specific code versions
- Enables automatic commit association

Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0`

## Issue Resolution Workflow

### Automatic Resolution

To automatically resolve Sentry issues:

1. Reference the issue in your commit message: `Fixes SENTRY-123`
2. When the fix is deployed, Sentry will mark the issue as resolved

### Manual Resolution

Alternatively, manually resolve issues in the Sentry UI and associate with a release.

## Troubleshooting

### Source Maps Not Working

1. Verify the auth token has proper permissions
2. Check that source maps are being generated (`sourceMap: true` in tsconfig.json)
3. Ensure the URL prefix matches the runtime path
4. Verify the release version matches between build and runtime

### Release Not Appearing

1. Check Cloud Build logs for errors
2. Verify the Sentry auth token is accessible
3. Ensure the organization and project names are correct
4. Check Sentry project settings for release visibility

### Local Testing

Test the Sentry integration locally:

```bash
# Build the project
pnpm run build

# Set environment variables
export SENTRY_ORG=mento-labs
export SENTRY_PROJECT=analytics-api
# Load $SENTRY_AUTH_TOKEN into shell context
set -a; source .env; set +a;

# Run the release script
./scripts/sentry-release.sh test-release-123

# Start the app with the release version
RELEASE_VERSION=test-release-123 pnpm run start:dev
```

## Security Considerations

1. **Auth Token**:
   - Production: Stored securely in Google Secret Manager
   - Local development: Use `.env` file (gitignored)
   - Never commit auth tokens to version control
2. **Source Maps**: Deleted after upload to prevent source code exposure
3. **Release Information**: Only includes commit SHA, no sensitive data

## Maintenance

- Update Sentry CLI regularly: `pnpm update @sentry/cli`
- Monitor the success rate of source map uploads in Cloud Build logs
