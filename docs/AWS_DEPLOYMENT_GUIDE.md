# AWS Deployment Guide - Complete Step-by-Step

## Prerequisites

### 1. Install Required Tools

```bash
# Node.js 18+
node --version

# AWS CLI v2
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# AWS CDK
npm install -g aws-cdk
cdk --version

# PostgreSQL client
brew install postgresql

# Docker
brew install --cask docker
```

### 2. AWS Account Setup

```bash
# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)

# Verify access
aws sts get-caller-identity
```

## Initial Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd community-content-tracker

# Install all dependencies
npm install
cd src/backend && npm install && cd ../..
cd src/frontend && npm install && cd ../..
cd src/infrastructure && npm install && cd ../..

# Install all dependencies
cd src/shared
npm install
npm run build
cd ../..
```

### 2. Environment Configuration

```bash
# Create environment file
cp .env.example .env

# Edit .env with:
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=<your-account-id>
ENVIRONMENT=dev
```

### 3. CDK Bootstrap

```bash
# One-time AWS account setup
cd src/infrastructure && cdk bootstrap aws://259096356287/us-east-1 && cd ../..
```

## Database Setup

### 1. Local Development Database

```bash
# Start PostgreSQL with Docker
docker-compose up -d postgres

# Run migrations
cd src/backend
DATABASE_URL="postgresql://contentuser:your-secure-password@localhost:5432/contenthub" npm run db:migrate

# Seed test data
DATABASE_URL="postgresql://contentuser:your-secure-password@localhost:5432/contenthub" npm run db:seed
```

## Infrastructure Deployment

### 1. Deploy Database Stack

```bash
cd src/infrastructure
npm run build

# Synthesize to verify
cdk synth CommunityContentHub-Database-Dev --context environment=dev

# Deploy database
cdk deploy CommunityContentHub-Database-Dev --context environment=dev
```

### 2. Deploy Cognito Stack

```bash
# Deploy Cognito User Pool
cdk deploy CommunityContentHub-Cognito-Dev --context environment=dev

# Note outputs:
# - UserPoolId
# - UserPoolClientId
# - PreSignupLambdaArn
```

### 3. Deploy API Gateway Stack

```bash
# Deploy API Gateway with Lambda functions
cdk deploy CommunityContentHub-ApiGateway-Dev --context environment=dev

# Note outputs:
# - ApiEndpoint
# - AuthorizerFunctionArn
```

### 4. Deploy All Stacks Together (Alternative)

```bash
# Deploy all stacks in dependency order
cdk deploy --all --context environment=dev
```

## Lambda Functions Setup

### 1. Build Lambda Functions

```bash
cd src/backend

# Build TypeScript
npm run build

# Package Lambda functions
npm run package:lambdas
```

### 2. Deploy Lambda Functions (if not using CDK)

```bash
# Deploy authorizer
aws lambda create-function \
  --function-name content-hub-authorizer-dev \
  --runtime nodejs18.x \
  --role arn:aws:iam::<ACCOUNT>:role/lambda-execution-role \
  --handler dist/lambdas/auth/authorizer.handler \
  --zip-file fileb://dist/lambdas/authorizer.zip

# Deploy register function
aws lambda create-function \
  --function-name content-hub-register-dev \
  --runtime nodejs18.x \
  --role arn:aws:iam::<ACCOUNT>:role/lambda-execution-role \
  --handler dist/lambdas/auth/register.handler \
  --zip-file fileb://dist/lambdas/register.zip

# Deploy login function
aws lambda create-function \
  --function-name content-hub-login-dev \
  --runtime nodejs18.x \
  --role arn:aws:iam::<ACCOUNT>:role/lambda-execution-role \
  --handler dist/lambdas/auth/login.handler \
  --zip-file fileb://dist/lambdas/login.zip
```

## Database Migration (Production)

### 1. Get RDS Endpoint

```bash
# Get database endpoint from CloudFormation
aws cloudformation describe-stacks \
  --stack-name CommunityTracker-Database-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' \
  --output text
```

### 2. Run Migrations

```bash
# Get database credentials from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id community-tracker/dev/database \
  --query SecretString --output text

# Set DATABASE_URL
export DATABASE_URL="postgresql://username:password@<rds-endpoint>:5432/contenthub"

# Run migrations
cd src/backend
npm run migrate:up
```

## Create Admin User

```bash
cd src/backend

# Set environment variables
export COGNITO_USER_POOL_ID=<from-stack-output>
export COGNITO_CLIENT_ID=<from-stack-output>
export DATABASE_URL=<your-database-url>

# Create admin user
npm run bootstrap:admin -- \
  --email admin@example.com \
  --username admin \
  --password AdminPassword123!
```

## Environment-Specific Deployment

### Development

```bash
cd src/infrastructure
./scripts/deploy.sh deploy dev
```

### Staging

```bash
./scripts/deploy.sh deploy staging
```

### Production

```bash
# Requires confirmation
./scripts/deploy.sh deploy prod
```

## Post-Deployment Configuration

### 1. Update Environment Variables

```bash
# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name CommunityTracker-Cognito-dev \
  --query 'Stacks[0].Outputs'

# Update .env with outputs
COGNITO_USER_POOL_ID=<UserPoolId>
COGNITO_CLIENT_ID=<UserPoolClientId>
API_GATEWAY_URL=<ApiEndpoint>
```

### 2. Configure CORS

```bash
# Update API Gateway CORS settings if needed
aws apigateway update-rest-api \
  --rest-api-id <api-id> \
  --patch-operations op=replace,path=/cors/allowOrigins,value="'*'"
```

### 3. Set Up CloudWatch Alarms

```bash
# Create billing alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "Monthly-Billing-Alert" \
  --alarm-description "Alert when AWS charges exceed $100" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold
```

## Verification

### 1. Test Database Connection

```bash
# Connect to RDS
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
```

### 2. Test API Endpoints

```bash
# Health check
curl https://<api-gateway-url>/health

# Register user
curl -X POST https://<api-gateway-url>/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testuser","password":"Test123!"}'

# Login
curl -X POST https://<api-gateway-url>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

### 3. Check Logs

```bash
# View Lambda logs
aws logs tail /aws/lambda/content-hub-authorizer-dev --follow

# View API Gateway logs
aws logs tail /aws/apigateway/CommunityContentTracker-dev --follow
```

## Monitoring

### 1. CloudWatch Dashboard

```bash
# Access CloudWatch
aws cloudwatch get-dashboard --dashboard-name CommunityTracker-dev
```

### 2. X-Ray Traces

```bash
# View traces
aws xray get-trace-summaries \
  --time-range-type LastHour \
  --query 'TraceSummaries[0:5]'
```

## Cleanup / Teardown

### Development Environment

```bash
cd src/infrastructure

# Destroy all stacks
cdk destroy --all --context environment=dev

# Or destroy individually
cdk destroy CommunityTracker-ApiGateway-dev --context environment=dev
cdk destroy CommunityTracker-Cognito-dev --context environment=dev
cdk destroy CommunityTracker-Database-dev --context environment=dev
```

### Local Cleanup

```bash
# Stop Docker containers
docker-compose down

# Remove volumes
docker-compose down -v
```

## Troubleshooting

### CDK Issues

```bash
# Clear CDK cache
rm -rf cdk.out

# Re-synthesize
cdk synth --context environment=dev

# Check diff
cdk diff --context environment=dev
```

### Lambda Issues

```bash
# Test Lambda locally
cd src/backend
npm run test:lambda

# Update function code
aws lambda update-function-code \
  --function-name content-hub-authorizer-dev \
  --zip-file fileb://dist/lambdas/authorizer.zip
```

### Database Issues

```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier content-hub-db-dev

# Check security groups
aws ec2 describe-security-groups \
  --group-ids <security-group-id>
```

## Quick Commands Reference

```bash
# Deploy everything
cd src/infrastructure && cdk deploy --all --context environment=dev

# Check deployment status
cdk list --context environment=dev

# View logs
aws logs tail /aws/lambda/<function-name> --follow

# Run migrations
cd src/backend && npm run db:migrate

# Create admin
npm run bootstrap:admin -- --email admin@example.com --username admin --password Pass123!

# Test API
curl https://<api-url>/health

# Destroy everything
cd src/infrastructure && cdk destroy --all --context environment=dev
```

## Cost Estimation

### Development Environment
- RDS t3.micro: ~$15/month
- Lambda: <$5/month
- API Gateway: <$5/month
- Total: ~$25/month

### Production Environment
- RDS r6g.large Multi-AZ: ~$200/month
- Lambda with reserved concurrency: ~$50/month
- API Gateway with caching: ~$30/month
- CloudFront CDN: ~$20/month
- Total: ~$300/month

## Support

For issues:
1. Check CloudWatch Logs
2. Review stack events in CloudFormation console
3. Check GitHub issues
4. Contact AWS Support if needed