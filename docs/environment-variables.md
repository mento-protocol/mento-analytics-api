# Environment Variables Guide

## Overview

This guide explains how environment variables are managed across different environments in the Mento Analytics API.

## Environment Strategy

We use a **per-environment secrets** approach:

| Environment | Secret Names | Purpose |
|------------|--------------|---------|
| Production | `*-prod` | Production secrets with full quotas |
| Preview | `*-preview` | Shared secrets for all preview deployments |
| Local Dev | `.env` file | Developer's personal keys |

## Required Environment Variables

### API URLs (Public, stored as env vars)

Default values are defined in `.env.example`

### API Keys (Sensitive, stored in Secret Manager)

- `EXCHANGE_RATES_API_KEY`: Exchange rates API authentication
- `COINMARKETCAP_API_KEY`: CoinMarketCap API authentication

### Runtime Configuration

- `NODE_ENV`: `production` | `development`
- `PORT`: Server port (default: 8080)
- `RELEASE_VERSION`: Version identifier for Sentry
- `SENTRY_DSN`: Sentry error tracking DSN (optional)

## Secret Management Best Practices

### 1. Use Environment-Specific Secrets

```bash
# Production secrets
coinmarketcap-api-key-prod
exchange-rates-api-key-prod

# Preview secrets (shared by all preview deployments)
coinmarketcap-api-key-preview
exchange-rates-api-key-preview
```

### 2. Grant Minimal Access

```bash
# Only grant access to the service accounts that need it
gcloud secrets add-iam-policy-binding SECRET_NAME \
  --member="serviceAccount:SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Version Management

```bash
# Always use 'latest' in deployments for easy rotation
--set-secrets="API_KEY=secret-name:latest"

# Rotate secrets by adding new versions
echo -n 'NEW_KEY' | gcloud secrets versions add secret-name --data-file=-
```

## Setting Up Environments

### Production

Production secrets should be set up by your infrastructure team with appropriate access controls.

### Preview Deployments

Run once to set up shared preview secrets:

```bash
./scripts/setup-preview-secrets.sh
```

### Local Development

Copy the example file and add your API keys:

```bash
cp .env.example .env
# Edit .env and add your API keys
```

The `.env.example` file includes all available options with documentation.

## Troubleshooting

### Missing Environment Variables

If the app fails with "X is not defined in environment variables":

1. Check if the secret exists:

   ```bash
   gcloud secrets list --filter="name:secret-name"
   ```

2. Verify the service account has access:

   ```bash
   gcloud secrets get-iam-policy secret-name
   ```

3. Check the Cloud Run service configuration:

   ```bash
   gcloud run services describe SERVICE_NAME --region=REGION
   ```

### Secret Access Denied

If you see permission errors:

1. Get the service account being used:

   ```bash
   gcloud run services describe SERVICE_NAME --format='value(spec.template.spec.serviceAccountName)'
   ```

2. Grant access:

   ```bash
   gcloud secrets add-iam-policy-binding SECRET_NAME \
     --member="serviceAccount:SA_EMAIL" \
     --role="roles/secretmanager.secretAccessor"
   ```
