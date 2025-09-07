# GitHub Secrets Configuration

This document outlines all required GitHub secrets for the CI/CD pipelines of the AWS Community Content Hub.

## Overview

The CI/CD pipeline uses GitHub Secrets to securely store sensitive information like AWS credentials, API keys, and other configuration values. Secrets are organized by environment (dev, staging, production) to ensure proper isolation.

## Required Secrets by Environment

### Development Environment

| Secret Name | Description | Example Value | Required For |
|-------------|-------------|---------------|--------------|
| `DEV_AWS_ACCESS_KEY_ID` | AWS Access Key for dev environment | `AKIAIOSFODNN7EXAMPLE` | Dev deployment |
| `DEV_AWS_SECRET_ACCESS_KEY` | AWS Secret Key for dev environment | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | Dev deployment |
| `DEV_AWS_ACCOUNT_ID` | AWS Account ID for dev environment | `123456789012` | CDK deployment |
| `DEV_ARTIFACTS_BUCKET` | S3 bucket for dev build artifacts | `aws-community-hub-dev-artifacts` | Build storage |

### Staging Environment

| Secret Name | Description | Example Value | Required For |
|-------------|-------------|---------------|--------------|
| `STAGING_AWS_ACCESS_KEY_ID` | AWS Access Key for staging environment | `AKIAIOSFODNN7EXAMPLE` | Staging deployment |
| `STAGING_AWS_SECRET_ACCESS_KEY` | AWS Secret Key for staging environment | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | Staging deployment |
| `STAGING_AWS_ACCOUNT_ID` | AWS Account ID for staging environment | `234567890123` | CDK deployment |
| `STAGING_ARTIFACTS_BUCKET` | S3 bucket for staging build artifacts | `aws-community-hub-staging-artifacts` | Build storage |

### Production Environment

| Secret Name | Description | Example Value | Required For |
|-------------|-------------|---------------|--------------|
| `PROD_AWS_ACCESS_KEY_ID` | AWS Access Key for production environment | `AKIAIOSFODNN7EXAMPLE` | Prod deployment |
| `PROD_AWS_SECRET_ACCESS_KEY` | AWS Secret Key for production environment | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | Prod deployment |
| `PROD_AWS_ACCOUNT_ID` | AWS Account ID for production environment | `345678901234` | CDK deployment |
| `PROD_ARTIFACTS_BUCKET` | S3 bucket for production build artifacts | `aws-community-hub-prod-artifacts` | Build storage |

### Optional Secrets (Enhanced Features)

| Secret Name | Description | Required For | Default Behavior |
|-------------|-------------|--------------|------------------|
| `CODECOV_TOKEN` | Codecov.io token for coverage reports | Code coverage | Skip coverage upload |
| `SNYK_TOKEN` | Snyk token for security scanning | Security scanning | Skip Snyk scan |
| `SLACK_WEBHOOK_URL` | Slack webhook for dev notifications | Dev notifications | Skip Slack notification |
| `SLACK_PRODUCTION_WEBHOOK` | Slack webhook for prod notifications | Prod notifications | Skip Slack notification |

## IAM Permissions Required

### Development Environment IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::aws-community-hub-dev-artifacts",
        "arn:aws:s3:::aws-community-hub-dev-artifacts/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:*:123456789012:function:aws-community-hub-dev-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate"
      ],
      "Resource": "arn:aws:cloudformation:*:123456789012:stack/aws-community-hub-dev-*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:ListDistributions"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:PutParameter"
      ],
      "Resource": "arn:aws:ssm:*:123456789012:parameter/aws-community-hub/dev/*"
    }
  ]
}
```

### Staging Environment IAM Policy

Similar to dev but with staging resources:
- Replace account ID: `234567890123`
- Replace environment: `staging`

### Production Environment IAM Policy

Similar to dev but with production resources:
- Replace account ID: `345678901234`
- Replace environment: `production`

## Setting Up GitHub Secrets

### Via GitHub Web Interface

1. Navigate to your repository
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Enter the secret name and value
5. Click **Add secret**

### Via GitHub CLI

```bash
# Development secrets
gh secret set DEV_AWS_ACCESS_KEY_ID --body "AKIAIOSFODNN7EXAMPLE"
gh secret set DEV_AWS_SECRET_ACCESS_KEY --body "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
gh secret set DEV_AWS_ACCOUNT_ID --body "123456789012"
gh secret set DEV_ARTIFACTS_BUCKET --body "aws-community-hub-dev-artifacts"

# Staging secrets
gh secret set STAGING_AWS_ACCESS_KEY_ID --body "AKIAIOSFODNN7EXAMPLE"
gh secret set STAGING_AWS_SECRET_ACCESS_KEY --body "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
gh secret set STAGING_AWS_ACCOUNT_ID --body "234567890123"
gh secret set STAGING_ARTIFACTS_BUCKET --body "aws-community-hub-staging-artifacts"

# Production secrets
gh secret set PROD_AWS_ACCESS_KEY_ID --body "AKIAIOSFODNN7EXAMPLE"
gh secret set PROD_AWS_SECRET_ACCESS_KEY --body "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
gh secret set PROD_AWS_ACCOUNT_ID --body "345678901234"
gh secret set PROD_ARTIFACTS_BUCKET --body "aws-community-hub-prod-artifacts"

# Optional secrets
gh secret set CODECOV_TOKEN --body "your-codecov-token"
gh secret set SNYK_TOKEN --body "your-snyk-token"
gh secret set SLACK_WEBHOOK_URL --body "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
```

## Environment Protection Rules

### Development
- No protection rules required
- Auto-deployment on main branch push

### Staging
- **Required reviewers**: Development team members
- **Deployment branches**: main branch only
- **Environment secrets**: Access to staging secrets only

### Production
- **Required reviewers**: 
  - Business stakeholders (for `production-business-approval`)
  - Technical leads (for `production-technical-approval`)
  - Senior engineers (for `production-final-approval`)
- **Deployment branches**: main branch only
- **Wait timer**: 5 minutes between approvals
- **Environment secrets**: Access to production secrets only

## S3 Bucket Setup

Each environment requires an S3 bucket for storing build artifacts:

### Bucket Naming Convention
- Dev: `aws-community-hub-dev-artifacts`
- Staging: `aws-community-hub-staging-artifacts`
- Production: `aws-community-hub-prod-artifacts`

### Bucket Configuration

```bash
# Create bucket (replace with your bucket name and region)
aws s3 mb s3://aws-community-hub-dev-artifacts --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket aws-community-hub-dev-artifacts \
  --versioning-configuration Status=Enabled

# Set lifecycle policy to cleanup old artifacts
aws s3api put-bucket-lifecycle-configuration \
  --bucket aws-community-hub-dev-artifacts \
  --lifecycle-configuration file://bucket-lifecycle.json
```

### Lifecycle Policy (`bucket-lifecycle.json`)

```json
{
  "Rules": [
    {
      "ID": "DeleteOldArtifacts",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "builds/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 365
      }
    },
    {
      "ID": "DeleteIncompleteUploads",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }
  ]
}
```

## Security Best Practices

### AWS IAM Users
1. Create dedicated IAM users for CI/CD (not root account)
2. Use principle of least privilege
3. Enable MFA for IAM users (where possible)
4. Rotate access keys regularly (at least quarterly)

### Secret Management
1. Never commit secrets to code
2. Use different AWS accounts for different environments
3. Regularly audit secret access
4. Use GitHub's secret scanning features

### Access Control
1. Limit who can modify GitHub secrets
2. Use environment protection rules
3. Require code review for workflow changes
4. Monitor deployment activities

## Troubleshooting

### Common Issues

1. **AWS credentials invalid**
   - Verify access key and secret key are correct
   - Check IAM permissions
   - Ensure account ID matches the environment

2. **S3 bucket not found**
   - Verify bucket name spelling
   - Check bucket region matches workflow region
   - Ensure bucket exists and is accessible

3. **CDK deployment fails**
   - Verify CDK CLI version compatibility
   - Check CloudFormation stack limits
   - Ensure proper IAM permissions for CDK

### Validation Commands

```bash
# Test AWS credentials
aws sts get-caller-identity

# Test S3 bucket access
aws s3 ls s3://your-bucket-name

# Test Lambda function access
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `aws-community-hub-dev`)]'

# Validate CDK can synthesize
cd src/infrastructure
npx cdk synth --all
```

## Monitoring and Alerts

### CloudWatch Alarms
Set up alarms for:
- Failed deployments
- High error rates
- Performance degradation

### GitHub Notifications
Configure notifications for:
- Failed workflows
- Successful production deployments
- Security scan alerts

### Slack Integration
If using Slack webhooks:
- Development notifications go to dev channel
- Production notifications go to ops/alerts channel
- Include deployment details and rollback information