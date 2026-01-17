# AWS Prerequisites

This guide outlines the AWS account setup and permissions required for the Community Content Hub project.

## AWS Account Requirements

### 1. AWS Account Setup

You'll need an active AWS account with:

- **Billing enabled**: Some services incur costs
- **Root access** or **IAM user with sufficient permissions**
- **MFA enabled** (highly recommended for security)

### 2. Required AWS Services

The project uses the following AWS services:

#### Compute & Storage
- **AWS Lambda**: Serverless functions
- **Amazon S3**: File storage and static hosting
- **Amazon CloudFront**: Content delivery network

#### Database
- **Amazon RDS** (PostgreSQL): Primary database
- **Amazon ElastiCache Serverless** (Valkey): Caching layer

#### Security & Access
- **AWS IAM**: Identity and access management
- **Amazon Cognito**: User authentication
- **AWS Secrets Manager**: Secret management

#### Monitoring & Logging
- **Amazon CloudWatch**: Monitoring and logs
- **AWS X-Ray**: Distributed tracing

#### Infrastructure
- **AWS CloudFormation**: Infrastructure as code
- **Amazon VPC**: Virtual private cloud
- **Application Load Balancer**: Load balancing

## IAM Permissions

### Option 1: Administrative Access (Recommended for Development)

For development environments, the simplest approach is to use an IAM user with `AdministratorAccess` policy.

**Warning**: Only use this for development. Production should use least-privilege access.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "*",
            "Resource": "*"
        }
    ]
}
```

### Option 2: Minimal Permissions (Production)

For production or restricted environments, use these specific permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "s3:*",
                "lambda:*",
                "iam:*",
                "apigateway:*",
                "rds:*",
                "elasticache:*",
                "ec2:*",
                "elasticloadbalancing:*",
                "cloudfront:*",
                "route53:*",
                "cognito-idp:*",
                "cognito-identity:*",
                "secretsmanager:*",
                "cloudwatch:*",
                "logs:*",
                "xray:*",
                "ssm:*"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole"
            ],
            "Resource": "arn:aws:iam::*:role/cdk-*"
        }
    ]
}
```

## Setting Up IAM User

### 1. Create IAM User

```bash
# Using AWS CLI (if you have admin access)
aws iam create-user --user-name community-content-developer

# Create access key
aws iam create-access-key --user-name community-content-developer
```

### 2. Attach Policies

```bash
# Attach administrator access (development only)
aws iam attach-user-policy \
  --user-name community-content-developer \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Or create custom policy for production
aws iam put-user-policy \
  --user-name community-content-developer \
  --policy-name CommunityContentHubPolicy \
  --policy-document file://iam-policy.json
```

### 3. Configure AWS CLI

```bash
aws configure --profile community-content-hub
```

Enter the following when prompted:
- **AWS Access Key ID**: From step 1
- **AWS Secret Access Key**: From step 1
- **Default region name**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

## Environment Variables Configuration

Add these AWS-specific variables to your `.env` file:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
AWS_PROFILE=community-content-hub

# CDK Configuration
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1

# Application Configuration
STAGE=dev
STACK_NAME=CommunityContentHub-dev

# Database Configuration (will be created by CDK)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=contenthub
DB_USER=contentuser
DB_PASSWORD=your-secure-password

# Cache Configuration (will be created by CDK)
REDIS_URL=redis://localhost:6379

# S3 Bucket Names (will be created by CDK)
CONTENT_BUCKET_NAME=community-content-hub-content-dev
ASSETS_BUCKET_NAME=community-content-hub-assets-dev

# CloudFront Distribution (will be created by CDK)
CLOUDFRONT_DOMAIN=https://d1234567890123.cloudfront.net

# Cognito Configuration (will be created by CDK)
COGNITO_USER_POOL_ID=us-east-1_ABC123DEF
COGNITO_CLIENT_ID=1234567890abcdef1234567890abcdef

# API Gateway Configuration (will be created by CDK)
API_GATEWAY_URL=https://api123456789.execute-api.us-east-1.amazonaws.com/dev

# Secrets Manager
SECRETS_MANAGER_SECRET_NAME=community-content-hub/dev/secrets
```

## Cost Considerations

### Expected Monthly Costs (Development)

| Service | Estimated Monthly Cost |
|---------|----------------------|
| RDS (db.t3.micro) | $15-25 |
| ElastiCache Serverless (Valkey) | Varies (usage-based) |
| Lambda (light usage) | $0-5 |
| S3 (development files) | $1-5 |
| CloudFront | $0-2 |
| NAT Gateway | $30-45 |
| **Total Estimated** | **Varies** |

### Cost Optimization Tips

1. **Use minimal database capacity** for development
2. **Enable auto-scaling** to scale down during off-hours
3. **Set up billing alerts** to monitor costs
4. **Use AWS Free Tier** when available
5. **Clean up resources** when not needed

```bash
# Set up billing alert
aws cloudwatch put-metric-alarm \
  --alarm-name "Billing-Alert" \
  --alarm-description "Billing Alert" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold
```

## Regional Considerations

### Recommended Regions

- **us-east-1** (N. Virginia): Lowest latency for most US users, all services available
- **us-west-2** (Oregon): Good for West Coast, cost-effective
- **eu-west-1** (Ireland): Good for European users

### Multi-Region Considerations

For production deployments, consider:

- **Primary region**: Where most users are located
- **Backup region**: For disaster recovery
- **Edge locations**: CloudFront automatically uses global edge locations

## Security Best Practices

### 1. Enable MFA

```bash
# Enable MFA for your IAM user
aws iam enable-mfa-device \
  --user-name community-content-developer \
  --serial-number arn:aws:iam::123456789012:mfa/community-content-developer \
  --authentication-code1 123456 \
  --authentication-code2 789012
```

### 2. Rotate Access Keys Regularly

```bash
# Create new access key
aws iam create-access-key --user-name community-content-developer

# Update your configuration
aws configure --profile community-content-hub

# Delete old access key (after testing)
aws iam delete-access-key --user-name community-content-developer --access-key-id OLDACCESSKEY
```

### 3. Use Secrets Manager

Store sensitive configuration in AWS Secrets Manager instead of environment variables:

```bash
# Create secret
aws secretsmanager create-secret \
  --name "community-content-hub/dev/database" \
  --description "Database credentials" \
  --secret-string '{"username":"contentuser","password":"secure-password"}'
```

## Validation

### 1. Test AWS CLI Access

```bash
# Check your identity
aws sts get-caller-identity --profile community-content-hub

# List S3 buckets (should work without error)
aws s3 ls --profile community-content-hub

# Test CloudFormation access
aws cloudformation list-stacks --profile community-content-hub
```

### 2. Test CDK Bootstrap

```bash
# Bootstrap CDK (one-time setup)
npx cdk bootstrap --profile community-content-hub

# Should see output like:
# PASS  Environment aws://123456789012/us-east-1 bootstrapped.
```

### 3. Verify Permissions

```bash
# Test creating a simple stack
npx cdk synth --profile community-content-hub

# Should generate CloudFormation templates without errors
```

## Troubleshooting

### Common Issues

1. **Access Denied Errors**
   - Check IAM permissions
   - Verify AWS profile configuration
   - Ensure MFA token is valid

2. **Region Mismatch**
   - Verify CDK_DEFAULT_REGION matches AWS_REGION
   - Check AWS CLI default region

3. **Bootstrap Issues**
   - Ensure sufficient permissions for CDK bootstrap
   - Check if bootstrap stack already exists

### Getting Help

- AWS Documentation: https://docs.aws.amazon.com/
- CDK Documentation: https://docs.aws.amazon.com/cdk/
- AWS Support: Available through AWS Console

## Next Steps

1. Configure your `.env` file with the AWS settings
2. Run `aws configure` to set up your credentials
3. Bootstrap CDK: `npx cdk bootstrap`
4. Continue with the [Local Development Setup](./local-development.md)
