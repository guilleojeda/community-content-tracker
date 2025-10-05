# AWS Community Content Hub - Deployment Instructions

## Overview

This document provides step-by-step instructions for deploying the AWS Community Content Hub to AWS using CDK.

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Node.js** 18+ and npm installed
3. **AWS CDK** CLI installed globally: `npm install -g aws-cdk`
4. **PostgreSQL** client for database setup (optional, for local testing)

## Quick Deploy

Use the automated deployment script:

```bash
# Deploy to dev environment
./scripts/deploy-all.sh dev

# Deploy to staging
./scripts/deploy-all.sh staging

# Deploy to production
./scripts/deploy-all.sh prod
```

## What Gets Deployed

When you run `cdk deploy --all --context environment=dev`, the following happens:

1. **Frontend Build**: Next.js app is built to static files in `src/frontend/out`
2. **CDK Stacks Deploy**: All infrastructure stacks are created/updated
3. **Website Deployment**: BucketDeployment automatically:
   - Uploads files from `src/frontend/out` to S3
   - Invalidates CloudFront cache
   - Sets proper cache control headers
   - Only uploads changed files (content hash tracking)

## Deployment Methods

### Method 1: From Infrastructure Directory

```bash
cd src/infrastructure

# Deploy to dev (builds frontend automatically)
npm run deploy:dev

# Deploy to staging
npm run deploy:staging

# Deploy to prod
npm run deploy:prod
```

### Method 2: Deploy Specific Stacks

```bash
cd src/infrastructure

# Build frontend first
npm run build:frontend

# Deploy only static site
cdk deploy CommunityContentHub-StaticSite-Dev --context environment=dev
```

## Updating Frontend Only

If you only changed frontend code:

```bash
cd src/infrastructure
npm run build:frontend
cdk deploy CommunityContentHub-StaticSite-Dev --context environment=dev
```

The BucketDeployment will detect changed files and only upload what's needed.

## Post-Deployment

Get your website URL:

```bash
aws cloudformation describe-stacks \
  --stack-name CommunityContentHub-StaticSite-Dev \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' \
  --output text
```

---

**Last Updated:** 2025-10-05
