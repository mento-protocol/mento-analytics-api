# Preview Deployments

This document describes the preview deployment system for the Mento Analytics API, which provides automatic branch-specific deployments similar to Vercel's preview deployments.

## Overview

The preview deployment system automatically creates isolated Cloud Run services for each branch and pull request, allowing you to test changes in a production-like environment before merging to main.

### Key Features

- **Automatic Deployments**: Every push to a branch creates or updates a preview deployment
- **PR Integration**: Pull requests automatically get a comment with the preview URL
- **Automatic Cleanup**: Preview deployments are automatically deleted when PRs are merged or closed
- **Resource Optimization**: Limited resources (512Mi memory, max 3 instances) to control costs
- **Branch Isolation**: Each branch gets its own isolated deployment

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   GitHub PR     │────▶│  GitHub Actions  │────▶│  Cloud Build    │
│   or Push       │     │   Workflow       │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │   Cloud Run     │
                                                  │  Preview Service│
                                                  └─────────────────┘
```

## Setup Requirements

To set up preview deployments, you need to configure Google Cloud resources and GitHub secrets.

### Quick Setup

Use the automated setup script:

```bash
./scripts/setup-preview-deployments.sh
```

This script will guide you through the entire setup process and generate the necessary GitHub secrets.

### Manual Setup

For detailed manual setup instructions or troubleshooting, see the [Setup Guide](setup-guide.md).

### Required Components

1. **Google Cloud APIs**: Cloud Build, Cloud Run, Artifact Registry
2. **Service Account**: With necessary IAM permissions
3. **Workload Identity Federation**: For secure GitHub Actions authentication
4. **GitHub Secrets**: `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT`

## How It Works

### Preview Deployment Flow

1. **Branch Push or PR Creation**:
   - GitHub Actions workflow (`preview-deploy.yaml`) is triggered
   - Branch name is converted to a safe Cloud Run service name
   - Cloud Build is triggered with `cloudbuild-preview.yaml`

2. **Build and Deploy**:
   - Docker image is built with branch-specific tag
   - Image is pushed to Artifact Registry
   - Cloud Run service is created/updated with the name: `mento-analytics-api-preview-{branch-name}`

3. **PR Comment**:
   - For PRs, a comment is automatically added with the preview URL
   - The comment is updated on subsequent pushes

### Cleanup Flow

1. **PR Merged/Closed or Branch Deleted**:
   - GitHub Actions workflow (`preview-cleanup.yaml`) is triggered
   - Cloud Build is triggered with `cloudbuild-cleanup.yaml`

2. **Cleanup**:
   - Cloud Run service is deleted
   - Old container images are cleaned up (keeps last 3)

## Service Naming Convention

Preview services follow this naming pattern:

```
analytics-api-preview-{sanitized-branch-name}
```

Branch name sanitization:

- Converts to lowercase
- Replaces non-alphanumeric characters with hyphens
- Removes leading/trailing hyphens
- Limits to 40 characters

Examples:

- `feature/new-api` → `analytics-api-preview-feature-new-api`
- `FEAT/Cool_Feature!` → `analytics-api-preview-feat-cool-feature`

## Resource Limits

Preview deployments have the following resource constraints:

- **Memory**: 512Mi
- **CPU**: 1 vCPU
- **Max Instances**: 3
- **Timeout**: 300 seconds
- **Allow Unauthenticated**: Yes (public access)

## Environment Variables

Preview deployments include these additional environment variables:

- `ENVIRONMENT=preview`
- `PREVIEW_BRANCH={branch-name}`
- `RELEASE_VERSION={branch-name}-{short-sha}`

## Technical Details

### Cloud Build Substitutions

When triggering builds manually or via GitHub Actions, use these substitution variables (prefixed with `_`):

- `_BRANCH_NAME`: The Git branch name
- `_SHORT_SHA`: First 7 characters of the commit SHA
- `_COMMIT_SHA`: Full commit SHA

### Image Storage

Docker images are stored in Artifact Registry without subdirectories:

```
us-central1-docker.pkg.dev/mento-prod/cloud-run-source-deploy/analytics-api-preview:{sanitized-branch}-{short-sha}
```

Note: Branch names are sanitized (slashes replaced with hyphens) for Docker tag compatibility.

### Build Optimization

A `.gcloudignore` file is used to exclude unnecessary files from the build upload, including:

- `node_modules/` (will be installed during build)
- `.git/` and `.github/`
- `dist/` and other build outputs
- Development and documentation files

### Variable Escaping in Cloud Build

In Cloud Build YAML files, bash variables must be escaped with `$$` to prevent Cloud Build from interpreting them as substitution variables:
- Use `$$SERVICE_NAME` instead of `$SERVICE_NAME`
- Use `$${VARIABLE}` instead of `${VARIABLE}` for bash variables
- Cloud Build substitutions remain as `${_VARIABLE_NAME}`

### Cloud Build Tags

Cloud Build tags must match the format `^[\w][\w.-]{0,127}$` (alphanumeric, dots, hyphens, underscores only). Branch names with slashes cannot be used as tags directly.

## Management Scripts

Use the `preview-deployments.sh` script for manual management:

```bash
# List all preview deployments
./scripts/preview-deployments.sh list

# Deploy a specific branch manually
./scripts/preview-deployments.sh deploy feature/my-branch

# Delete a specific preview
./scripts/preview-deployments.sh delete feature/old-branch

# Get URL for a preview
./scripts/preview-deployments.sh get-url feature/my-branch

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

## Cost Considerations

To minimize costs:

1. **Automatic Cleanup**: Ensures resources are freed when no longer needed
2. **Resource Limits**: Preview deployments use minimal resources
3. **Image Cleanup**: Old container images are automatically deleted
4. **Manual Cleanup**: Use the script to remove old previews:

   ```bash
   ./scripts/preview-deployments.sh cleanup-old 3
   ```

## Security Notes

1. **Public Access**: Preview deployments are publicly accessible. Don't include sensitive data.
2. **Environment Isolation**: Each preview runs in its own Cloud Run service
3. **Temporary Nature**: Previews are meant to be temporary and are automatically cleaned up

## Future Enhancements

Potential improvements to consider:

1. **Custom Domains**: Add custom subdomains for preview deployments
2. **Authentication**: Add optional authentication for preview deployments
3. **Database Isolation**: Create isolated database instances for previews
4. **Performance Metrics**: Add monitoring and performance tracking
5. **Cost Tracking**: Add labels for better cost attribution
