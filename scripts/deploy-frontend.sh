#!/bin/bash
set -e

#############################################################################
# Frontend Deployment Script for AWS Community Content Hub
#
# This script:
# 1. Builds the Next.js frontend
# 2. Uploads static files to S3
# 3. Invalidates CloudFront cache
#
# Usage:
#   ./scripts/deploy-frontend.sh [environment]
#
# Environment: dev, staging, prod, blue, green, beta (default: dev)
#############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Parse environment argument
ENVIRONMENT=${1:-dev}

# Validate environment
if [[ "$ENVIRONMENT" == "production" ]]; then
    ENVIRONMENT="prod"
fi

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod|blue|green|beta)$ ]]; then
    log_error "Invalid environment: $ENVIRONMENT"
    log_info "Usage: ./scripts/deploy-frontend.sh [dev|staging|prod|blue|green|beta]"
    exit 1
fi

log_info "Starting frontend deployment for environment: $ENVIRONMENT"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed. Please install it first:"
    log_info "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured. Please run 'aws configure'"
    exit 1
fi

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
AWS_REGION=${AWS_REGION:-us-east-1}

log_info "AWS Account: $AWS_ACCOUNT_ID"
log_info "AWS Region: $AWS_REGION"

# Retrieve S3 bucket name and CloudFront distribution ID from SSM
log_info "Retrieving deployment configuration from SSM..."

BUCKET_NAME=$(aws ssm get-parameter \
    --name "/${ENVIRONMENT}/static-site/bucket-name" \
    --region "$AWS_REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "")

DISTRIBUTION_ID=$(aws ssm get-parameter \
    --name "/${ENVIRONMENT}/static-site/distribution-id" \
    --region "$AWS_REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "")

# Fallback to CloudFormation outputs if SSM parameters don't exist
if [[ -z "$BUCKET_NAME" ]] || [[ -z "$DISTRIBUTION_ID" ]]; then
    log_warning "SSM parameters not found. Attempting to retrieve from CloudFormation..."

    ENV_CAPITALIZED="$(tr '[:lower:]' '[:upper:]' <<< "${ENVIRONMENT:0:1}")${ENVIRONMENT:1}"
    STACK_NAME="CommunityContentHub-StaticSite-${ENV_CAPITALIZED}"

    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
        --output text 2>/dev/null || echo "")

    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
        --output text 2>/dev/null || echo "")
fi

# Validate that we have the required values
if [[ -z "$BUCKET_NAME" ]]; then
    log_error "Could not retrieve S3 bucket name. Has the infrastructure been deployed?"
    log_info "Deploy infrastructure first with: cd src/infrastructure && npm run cdk:deploy"
    exit 1
fi

if [[ -z "$DISTRIBUTION_ID" ]]; then
    log_error "Could not retrieve CloudFront distribution ID."
    exit 1
fi

log_success "S3 Bucket: $BUCKET_NAME"
log_success "CloudFront Distribution: $DISTRIBUTION_ID"

# Build the Next.js frontend
log_info "Building Next.js frontend..."
cd src/frontend

# Clean previous builds
rm -rf .next out

# Run build
npm run build

if [[ $? -ne 0 ]]; then
    log_error "Frontend build failed"
    exit 1
fi

log_success "Frontend build completed"

# Check if Next.js static export was created
if [[ ! -d "out" ]]; then
    log_error "Build output directory 'out' not found."
    log_info "Make sure next.config.js has 'output: export' configured for static export"
    exit 1
fi

# Upload files to S3
log_info "Uploading files to S3 bucket: $BUCKET_NAME..."

# Sync files to S3 with appropriate cache headers
# HTML files - short cache
aws s3 sync out/ "s3://${BUCKET_NAME}/" \
    --region "$AWS_REGION" \
    --delete \
    --exclude "*" \
    --include "*.html" \
    --cache-control "public, max-age=300, s-maxage=300" \
    --metadata-directive REPLACE

# Static assets - long cache (with content hashing)
aws s3 sync out/ "s3://${BUCKET_NAME}/" \
    --region "$AWS_REGION" \
    --exclude "*.html" \
    --include "_next/*" \
    --cache-control "public, max-age=31536000, immutable" \
    --metadata-directive REPLACE

# Other files - medium cache
aws s3 sync out/ "s3://${BUCKET_NAME}/" \
    --region "$AWS_REGION" \
    --exclude "*.html" \
    --exclude "_next/*" \
    --cache-control "public, max-age=86400" \
    --metadata-directive REPLACE

if [[ $? -ne 0 ]]; then
    log_error "Failed to upload files to S3"
    exit 1
fi

log_success "Files uploaded to S3"

# Create CloudFront invalidation
log_info "Creating CloudFront cache invalidation..."

INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --query "Invalidation.Id" \
    --output text)

if [[ $? -ne 0 ]]; then
    log_error "Failed to create CloudFront invalidation"
    exit 1
fi

log_success "CloudFront invalidation created: $INVALIDATION_ID"

# Get CloudFront distribution domain
DISTRIBUTION_DOMAIN=$(aws cloudfront get-distribution \
    --id "$DISTRIBUTION_ID" \
    --query "Distribution.DomainName" \
    --output text)

log_success "Deployment completed successfully!"
log_info ""
log_info "====================================="
log_info "Deployment Summary"
log_info "====================================="
log_info "Environment:        $ENVIRONMENT"
log_info "S3 Bucket:          $BUCKET_NAME"
log_info "Distribution ID:    $DISTRIBUTION_ID"
log_info "Invalidation ID:    $INVALIDATION_ID"
log_info "Website URL:        https://${DISTRIBUTION_DOMAIN}"
log_info "====================================="
log_info ""
log_warning "Note: CloudFront invalidation may take 5-15 minutes to complete"
log_info "Check invalidation status:"
log_info "  aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $INVALIDATION_ID"
log_info ""

cd ../..
