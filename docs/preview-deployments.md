# Preview Deployments

This document describes the preview deployment system for the Mento Analytics API, which provides automatic branch-specific deployments similar to Vercel's preview deployments.

## Overview

The preview deployment system automatically creates isolated Cloud Run services for each branch and pull request, allowing you to test changes in a production-like environment before merging to `main`.

### Key Features

- **Automatic Deployments**: Every push to an open pull request creates or updates a preview deployment
- **Branch Isolation**: Each branch gets its own isolated deployment
- **PR Integration**: Pull requests automatically get a comment with the preview URL
- **Automatic Cleanup**: Preview deployments are automatically deleted when PRs are merged or closed
- **Performance Optimized**: Docker builds only run when relevant files change (Dockerfile, package.json, src/, etc.)
- **Efficient Caching**: GitHub Actions caches dependencies and Docker layers for faster builds

## Architecture

```txt
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   GitHub PR     │────▶│  GitHub Actions  │────▶│  Artifact       │
│    Update       │     │   Workflow       │     │  Registry       │
└─────────────────┘     │  (Build & Push)  │     └────────┬────────┘
                        └──────────────────┘              │
                                                          │
                        ┌──────────────────┐              │
                        │  Cloud Build     │◀─────────────┘
                        │  (Deploy Only)   │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   Cloud Run     │
                        │  Preview Service│
                        └─────────────────┘
```

## First Time Setup Requirements

To set up preview deployments, you need to configure Google Cloud resources and GitHub secrets.

### Quick Setup

Use the automated setup script:

```bash
./scripts/setup-preview-deployments.sh
```

This script will guide you through the entire setup process and generate the necessary GitHub secrets.

### Manual Setup

For detailed manual setup instructions or troubleshooting, see the [Preview Deployments Setup Guide](preview-deployments-setup-guide.md).

## How It Works

### Preview Deployment Flow

1. **PR Creation or Update**:
   - GitHub Actions workflow ([`preview-deploy.yaml`](../.github/workflows/preview-deploy.yaml)) is triggered
   - Branch name is converted to a safe Cloud Run service name
   - Docker image is built and pushed to Artifact Registry (if code changes detected)
   - Cloud Build is triggered with [`cloudbuild-preview.yaml`](../cloudbuild-preview.yaml)

2. **Build and Deploy**:
   - **GitHub Actions**: Builds Docker image with branch-specific tag and pushes to Artifact Registry
   - **Cloud Build**: Deploys the pre-built image to Cloud Run service with name: `analytics-api-preview-{branch-name}`
   - **Performance**: Docker builds only run when relevant files change (Dockerfile, package.json, src/, etc.)

3. **PR Comment**:
   - A comment is automatically added with the preview URL
   - The comment is updated on subsequent pushes

### Cleanup Flow

1. **PR Merged/Closed**:
   - GitHub Actions workflow ([`preview-cleanup.yaml`](../.github/workflows/preview-cleanup.yaml)) is triggered
   - Cloud Build is triggered with [`cloudbuild-cleanup.yaml`](../cloudbuild-cleanup.yaml)

2. **Cleanup**:
   - Cloud Run service is deleted
   - Old container images are cleaned up (keeps last 3)

## Service Naming Convention

Preview services follow this naming pattern:

```text
analytics-api-preview-{safe-branch-name}
```

Branch name sanitization:

- Converts to lowercase
- Replaces non-alphanumeric characters with hyphens
- Removes leading/trailing hyphens
- Limits to 40 characters

Examples:

- `feat/new-api` → `analytics-api-preview-feat-new-api`
- `FEAT/Cool_Feature!` → `analytics-api-preview-feat-cool-feature`

## Environment Variables & Secrets

### Env Vars

- [`.env.example`](../.env.example) - Source of truth for all default and non-secret environment variables
- [`scripts/env-config.sh`](../scripts/env-config.sh) - Copies `.env.example` into `.env` and loads all relevant env vars into the shell context

See the [Environment Variables Guide](./environment-variables.md) for full details.

### Secrets (API Keys)

Preview deployments use a **shared secrets approach** following Google Cloud best practices:

- All preview deployments share the same preview-specific secrets
- Secrets are stored in Google Secret Manager with `-preview` suffix
- Separate from production secrets for security and quota management
- The default compute service account automatically has access

#### One-Time Secret Setup Required

Before preview deployments can work, run the setup script **once**:

```bash
# Run this once to set up all secrets (API keys and RPC URLs)
./scripts/setup-secrets.sh
```

This unified script will guide you through setting up both API keys and RPC URLs for your chosen environments.

## Management Scripts

Use the [`preview-deployments.sh`](../scripts/preview-deployments.sh) script for manual management:

```bash
# List all preview deployments
./scripts/preview-deployments.sh list

# Deploy current branch (with confirmation prompt)
./scripts/preview-deployments.sh deploy

# Deploy a specific branch manually
./scripts/preview-deployments.sh deploy feature/my-branch

# Delete current branch preview (with confirmation prompt)
./scripts/preview-deployments.sh delete

# Delete a specific preview
./scripts/preview-deployments.sh delete feature/old-branch

# Cleanup old previews (older than 7 days by default)
./scripts/preview-deployments.sh cleanup-old

# Cleanup previews older than 14 days
./scripts/preview-deployments.sh cleanup-old 14
```

## Monitoring

### View Logs

```bash
# Get logs for a specific preview deployment
gcloud run services logs read analytics-api-preview-{branch-name} \
  --region=us-central1 \
  --project=mento-prod \
  --limit=100
```

### View Deployments

```bash
# List all preview deployments
gcloud run services list \
  --platform=managed \
  --region=us-central1 \
  --project=mento-prod \
  --filter="metadata.labels.managed-by:preview-deployments"
```

## Troubleshooting

### Preview deployment not created

1. Check GitHub Actions logs for errors
2. Verify GitHub secrets are correctly set
3. Check Cloud Build logs:

   ```bash
   gcloud builds list --limit=10 --project=mento-prod
   ```

### Preview URL not accessible

1. Verify the service was created:

   ```bash
   ./scripts/preview-deployments.sh list
   ```

2. Check service logs for startup errors
3. Ensure the service allows unauthenticated access

### Cleanup not working

1. Check if the service still exists
2. Verify the branch name matches exactly
3. Check cleanup workflow logs in GitHub Actions
