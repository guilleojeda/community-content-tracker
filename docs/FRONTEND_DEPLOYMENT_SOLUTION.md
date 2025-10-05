# Frontend Deployment Solution - AWS Community Content Hub

## Overview

This document describes the automatic frontend deployment solution integrated into the CDK infrastructure deployment process.

## Solution Architecture

### How It Works

When you run `cdk deploy --all --context environment=dev`, the deployment process:

1. **Pre-Deployment Build** (via npm scripts)
   - Runs `npm run build:frontend` before CDK deploy
   - Builds Next.js static export to `src/frontend/out`
   - Generates optimized static files (HTML, JS, CSS)

2. **CDK Deployment** (BucketDeployment construct)
   - CDK's `BucketDeployment` construct packages build output
   - Creates a Lambda function that runs during deployment
   - Uploads files from `src/frontend/out` to S3 bucket
   - Invalidates CloudFront cache automatically
   - Uses content hashing to detect changes

3. **Post-Deployment**
   - CloudFront cache invalidated (path: `/*`)
   - Website accessible via CloudFront URL immediately
   - Deployment completes when all files are uploaded

### Key Components

#### 1. StaticSiteStack Updates

**File**: `src/infrastructure/lib/stacks/static-site-stack.ts`

Added imports:
```typescript
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
```

Added deployment construct (lines 408-439):
```typescript
const deployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
  sources: [s3deploy.Source.asset(buildOutputPath)],
  destinationBucket: this.bucket,
  distribution: this.distribution,
  distributionPaths: ['/*'],
  cacheControl: [
    s3deploy.CacheControl.setPublic(),
    s3deploy.CacheControl.maxAge(cdk.Duration.minutes(5)),
  ],
  prune: true,
  retainOnDelete: false,
  memoryLimit: 512,
});
```

#### 2. Package.json Scripts

**File**: `src/infrastructure/package.json`

Added scripts:
```json
{
  "build:frontend": "cd ../frontend && npm run build",
  "synth": "npm run build:frontend && cdk synth",
  "deploy:dev": "npm run build:frontend && cdk deploy --all --context environment=dev",
  "deploy:staging": "npm run build:frontend && cdk deploy --all --context environment=staging",
  "deploy:prod": "npm run build:frontend && cdk deploy --all --context environment=prod"
}
```

#### 3. Deployment Script

**File**: `scripts/deploy-all.sh`

Automated deployment script that:
- Validates environment (dev/staging/prod)
- Installs dependencies
- Builds frontend
- Verifies build output
- Builds CDK infrastructure
- Deploys all stacks

Usage:
```bash
./scripts/deploy-all.sh dev
```

## Deployment Workflows

### Full Stack Deployment

```bash
cd src/infrastructure
npm run deploy:dev
```

This will:
1. Build Next.js frontend → `src/frontend/out`
2. Deploy all CDK stacks
3. Upload frontend files to S3
4. Invalidate CloudFront cache
5. Output website URL

### Frontend-Only Updates

```bash
cd src/infrastructure
npm run build:frontend
cdk deploy CommunityContentHub-StaticSite-Dev --context environment=dev
```

BucketDeployment will:
- Compare content hashes
- Upload only changed files
- Invalidate affected CloudFront paths
- Complete in seconds

### Infrastructure-Only Updates

If no frontend changes:
```bash
cd src/infrastructure
cdk deploy CommunityContentHub-Database-Dev --context environment=dev
```

Frontend deployment is skipped if build output hasn't changed.

## Content Hash Tracking

BucketDeployment uses content hashing to detect changes:

1. **Initial Deploy**: All files uploaded to S3
2. **Subsequent Deploys**: 
   - Calculates hash of each file in build output
   - Compares with previously deployed hashes
   - Only uploads files with changed hashes
   - Significantly faster for minor updates

Example:
- Change one React component
- Run `npm run deploy:dev`
- Only updated JS chunks are uploaded
- CloudFront invalidation only for changed paths

## CloudFront Cache Invalidation

Automatic invalidation configured:

```typescript
distributionPaths: ['/*']  // Invalidates all paths
```

**Alternatives**:
- `['/index.html']` - Only invalidate homepage
- `['/static/*']` - Only invalidate static assets
- `['/*']` - **Current**: Invalidate everything (safest)

**Cost**: First 1,000 invalidations/month are free, then $0.005 per path

## Cache Control Strategy

Two-level caching:

### 1. CloudFront Cache Policies (Primary)
- **HTML files**: 5 minutes (CachePolicyLine 117-126)
- **Static assets**: 1 day - 365 days (lines 106-115)
- **API calls**: No caching (lines 95-104)

### 2. S3 Cache Control (Fallback)
```typescript
cacheControl: [
  s3deploy.CacheControl.setPublic(),
  s3deploy.CacheControl.maxAge(cdk.Duration.minutes(5)),
]
```

## Environment-Specific Configuration

### Development (dev)
```bash
npm run deploy:dev
```
- S3 auto-delete on stack deletion
- No WAF (cost savings)
- CloudFront Price Class 100 (US/Canada/Europe)
- Min Aurora capacity: 0.5 ACU

### Staging
```bash
npm run deploy:staging
```
- Backup retention: 14 days
- CloudFront Price Class 100
- Min Aurora capacity: 1 ACU

### Production (prod)
```bash
npm run deploy:prod
```
- S3 versioning enabled
- WAF enabled
- CloudFront Price Class All (global)
- Deletion protection
- Backup retention: 30 days
- Min Aurora capacity: 1 ACU

## Troubleshooting

### Build Output Not Found

**Error**: `Error: Cannot find asset at path: src/frontend/out`

**Solution**:
```bash
cd src/frontend
npm run build
# Verify output
ls -la out/
```

### Permission Denied

**Error**: `AccessDenied: User is not authorized to perform: s3:PutObject`

**Solution**: Ensure CDK deployment role has S3 write permissions
```bash
cdk bootstrap  # Re-bootstrap if needed
```

### CloudFront Invalidation Fails

**Error**: `Invalidation failed: TooManyInvalidationsInProgress`

**Solution**: Wait for previous invalidation to complete (typically 30-60 seconds)
```bash
# Check invalidation status
aws cloudfront list-invalidations --distribution-id <dist-id>
```

### Stale Content After Deploy

**Issue**: Old content still showing after deployment

**Solutions**:
1. Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
2. Clear browser cache
3. Check CloudFront invalidation completed:
   ```bash
   aws cloudfront get-invalidation \
     --distribution-id <dist-id> \
     --id <invalidation-id>
   ```

## Cost Considerations

### Development Environment
- **S3 Storage**: ~$0.023/GB/month (minimal for frontend)
- **S3 Requests**: ~$0.0004/1K PUT requests
- **CloudFront**: First 1TB free tier (dev usage ~negligible)
- **CloudFront Invalidations**: First 1,000/month free
- **Lambda (Deployment)**: Runs only during deploy (~$0)

**Estimated monthly cost**: < $1

### Production Environment
- **S3 Storage**: ~$0.023/GB/month
- **S3 Requests**: Covered by CloudFront
- **CloudFront**: $0.085/GB after free tier
- **WAF**: ~$5/month + $0.60 per million requests
- **CloudFront Invalidations**: ~$0.005 per path

**Estimated monthly cost**: $10-50 (depends on traffic)

## Monitoring

### Deployment Logs

```bash
# View BucketDeployment Lambda logs
aws logs tail /aws/lambda/CommunityContentHub-StaticSite-Dev-DeployWebsite --follow
```

### S3 Metrics

```bash
# Check bucket size
aws s3 ls s3://community-content-hub-dev-<account> --recursive --summarize

# View bucket metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=community-content-hub-dev-<account> \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 86400 \
  --statistics Average
```

### CloudFront Metrics

```bash
# View distribution metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=<dist-id> \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## Best Practices

1. **Always Build Before Deploy**
   - Use npm scripts that build first
   - Never deploy without fresh build
   - Verify build output exists

2. **Environment Variables**
   - Set NEXT_PUBLIC_* vars before build
   - Different values per environment
   - Never commit secrets to .env

3. **Cache Strategy**
   - Long cache for static assets (versioned URLs)
   - Short cache for HTML (5 minutes)
   - No cache for API routes

4. **Monitoring**
   - Monitor CloudFront hit ratio
   - Track invalidation costs
   - Alert on 4xx/5xx errors

5. **Rollback Plan**
   - Keep S3 versioning enabled (prod)
   - Tag successful deployments in git
   - Document rollback procedure

## Security Considerations

1. **S3 Bucket**
   - Block all public access ✓
   - Only CloudFront OAI can read ✓
   - Encryption at rest enabled ✓

2. **CloudFront**
   - HTTPS only (redirect HTTP) ✓
   - Security headers enforced ✓
   - WAF enabled (prod) ✓

3. **Deployment**
   - IAM role with minimal permissions ✓
   - No secrets in build output ✓
   - Build process validated ✓

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy Frontend
on:
  push:
    branches: [main]
    paths:
      - 'src/frontend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy
        run: |
          cd src/infrastructure
          npm run deploy:prod
```

## References

- [AWS CDK BucketDeployment](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html)
- [CloudFront Invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)
- [Next.js Static Export](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [S3 Static Website Hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)

---

**Last Updated**: 2025-10-05
**CDK Version**: 2.199.0
**Next.js Version**: 14.2.33
