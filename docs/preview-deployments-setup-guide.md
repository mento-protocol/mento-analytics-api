# Preview Deployments Setup Guide

This guide walks you through setting up preview deployments for the Mento Analytics API using Google Cloud and GitHub Actions.

## Prerequisites

Before starting, ensure you have:

1. **Google Cloud Account** with billing enabled
2. **GitHub Repository** for your project
3. **gcloud CLI** installed ([Installation Guide](https://cloud.google.com/sdk/docs/install))
4. **Appropriate permissions** in your GCP project (Project Editor or Owner role)
5. **GitHub repository admin access** to add secrets

## Quick Setup (Automated)

We provide an automated setup script that configures most of the Google Cloud resources:

```bash
# Run the setup script
./scripts/setup-preview-deployments.sh
```

The script will:

- Check prerequisites
- Enable required Google Cloud APIs
- Create a service account with necessary permissions
- Set up Workload Identity Federation
- Generate GitHub secrets for you to add

## Manual Setup Guide

If you prefer to set up manually or need to understand each step:

### Step 1: Enable Google Cloud APIs

```bash
# Set your project
export PROJECT_ID="mento-prod"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable iam.googleapis.com
gcloud services enable iamcredentials.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
gcloud services enable sts.googleapis.com
```

### Step 2: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create github-preview-deployments \
  --display-name="GitHub Actions Preview Deployments" \
  --description="Service account for GitHub Actions to deploy preview environments"

# Get the service account email
export SA_EMAIL="github-preview-deployments@${PROJECT_ID}.iam.gserviceaccount.com"
```

### Step 3: Grant IAM Roles

```bash
# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudbuild.builds.builder"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"
```

### Step 4: Set up Workload Identity Federation

```bash
# Get project number
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

# Create workload identity pool
gcloud iam workload-identity-pools create github-actions-pool \
  --location="global" \
  --description="Pool for GitHub Actions" \
  --display-name="GitHub Actions Pool"

# Create workload identity provider (replace YOUR_GITHUB_ORG)
export GITHUB_ORG="YOUR_GITHUB_ORG"
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location="global" \
  --workload-identity-pool="github-actions-pool" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'"
```

### Step 5: Configure Service Account Access

```bash
# Replace with your GitHub org/repo
export GITHUB_REPO="YOUR_GITHUB_ORG/mento-analytics-api"

# Grant workload identity user role
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/${GITHUB_REPO}"
```

### Step 6: Create Artifact Registry Repository

```bash
# Create repository if it doesn't exist
gcloud artifacts repositories create cloud-run-source-deploy \
  --location="us-central1" \
  --repository-format="docker" \
  --description="Docker repository for Cloud Run deployments"
```

### Step 7: Get GitHub Secrets

```bash
# Get the Workload Identity Provider resource name
echo "WIF_PROVIDER:"
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/providers/github-provider"

echo ""
echo "WIF_SERVICE_ACCOUNT:"
echo "$SA_EMAIL"
```

### Step 8: Add Secrets to GitHub

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret" and add:
   - **Name**: `WIF_PROVIDER`
   - **Value**: The WIF_PROVIDER value from step 7
4. Click "New repository secret" again and add:
   - **Name**: `WIF_SERVICE_ACCOUNT`
   - **Value**: The service account email from step 7

## Verification

After setup, verify everything is working:

### 1. Check Service Account

```bash
gcloud iam service-accounts describe $SA_EMAIL
```

### 2. Check Workload Identity Pool

```bash
gcloud iam workload-identity-pools describe github-actions-pool --location="global"
```

### 3. Test with a Pull Request

1. Create a new branch: `git checkout -b test/preview-deployments`
2. Make a small change and commit
3. Push the branch: `git push origin test/preview-deployments`
4. Create a pull request
5. Check the Actions tab in GitHub for the deployment status
6. Look for the preview URL comment in the PR

## Permission Requirements

To set up Workload Identity Federation, you need one of the following:

1. **Project Owner** role on the Google Cloud project
2. **Specific IAM roles** including:
   - `roles/iam.workloadIdentityPoolAdmin`
   - `roles/iam.serviceAccountAdmin`
   - `roles/serviceusage.serviceUsageAdmin`
   - `roles/resourcemanager.projectIamAdmin`

If you encounter permission errors, use the admin setup script:

```bash
./scripts/setup-preview-deployments-admin.sh
```

This script can:

- Check your current permissions
- Grant necessary permissions (if run by a Project Owner)
- Create all resources directly (if you're a Project Owner)

## Troubleshooting

### Permission Denied Errors

If you see errors like `Permission 'iam.workloadIdentityPools.create' denied`:

1. **Option 1**: Ask a Project Owner to run the admin setup script:

   ```bash
   ./scripts/setup-preview-deployments-admin.sh
   ```

   They can either grant you permissions or create the resources directly.

2. **Option 2**: If you're a Project Owner, run the admin script yourself to create resources.

3. **Option 3**: Request the necessary IAM roles from your GCP administrator.

### Authentication Errors

If you see authentication errors in GitHub Actions:

1. Verify the WIF_PROVIDER format is correct:

   ```
   projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_NAME/providers/PROVIDER_NAME
   ```

2. Check the attribute condition matches your GitHub organization

3. Ensure the service account has the correct IAM bindings

### Permission Errors

If you see permission errors:

1. Verify all required APIs are enabled:

   ```bash
   gcloud services list --enabled | grep -E "(cloudbuild|run|artifactregistry|iam)"
   ```

2. Check service account roles:

   ```bash
   gcloud projects get-iam-policy $PROJECT_ID \
     --flatten="bindings[].members" \
     --filter="bindings.members:serviceAccount:$SA_EMAIL" \
     --format="table(bindings.role)"
   ```

### Build Failures

If Cloud Build fails:

1. Check Cloud Build logs:

   ```bash
   gcloud builds list --limit=5
   gcloud builds log BUILD_ID
   ```

2. Verify the Dockerfile exists and is valid

3. Check that the branch name doesn't contain invalid characters

## Security Best Practices

1. **Limit Repository Access**: The Workload Identity attribute condition restricts access to your specific GitHub organization

2. **Minimal Permissions**: The service account only has the minimum required permissions

3. **Temporary Resources**: Preview deployments are automatically cleaned up

4. **No Production Access**: Preview deployments use separate service accounts from production

## Cost Management

To keep costs low:

1. **Resource Limits**: Preview deployments are limited to 512Mi memory and 3 instances
2. **Automatic Cleanup**: Services are deleted when PRs are closed
3. **Regular Cleanup**: Use the management script to clean old deployments:

   ```bash
   ./scripts/preview-deployments.sh cleanup-old 3
   ```

## Support

If you encounter issues:

1. Check the [Preview Deployments Documentation](preview-deployments.md)
2. Review GitHub Actions logs
3. Check Cloud Build logs in Google Cloud Console
4. Verify all secrets are correctly set in GitHub
