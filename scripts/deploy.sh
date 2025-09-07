#!/bin/bash

# AWS Community Content Hub - Deployment Script
# Usage: ./scripts/deploy.sh <environment> <commit_sha>
# Example: ./scripts/deploy.sh dev abc1234
#          ./scripts/deploy.sh staging def5678
#          ./scripts/deploy.sh production abc1234

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}" >&2; }

# Global variables
ENVIRONMENT=""
COMMIT_SHA=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Default values (can be overridden by environment variables)
AWS_REGION="${AWS_REGION:-us-east-1}"
S3_ARTIFACTS_BUCKET="${S3_ARTIFACTS_BUCKET:-}"
CDK_OUTPUT_FILE="cdk-outputs.json"

# Function to show usage
show_usage() {
    cat << EOF
AWS Community Content Hub - Deployment Script

Usage: $0 <environment> <commit_sha>

Arguments:
  environment   Target environment (dev, staging, production)
  commit_sha    Git commit SHA to deploy (7-40 characters)

Environment Variables:
  AWS_REGION                AWS region for deployment (default: us-east-1)
  S3_ARTIFACTS_BUCKET      S3 bucket for build artifacts
  
Examples:
  $0 dev abc1234
  $0 staging def5678901234567890abcdef567890123456789  
  $0 production a1b2c3d

Required AWS CLI configuration:
  - AWS credentials configured via environment variables or AWS CLI
  - Appropriate IAM permissions for target environment
EOF
}

# Function to validate inputs
validate_inputs() {
    if [[ $# -lt 2 ]]; then
        log_error "Missing required arguments"
        show_usage
        exit 1
    fi

    ENVIRONMENT="$1"
    COMMIT_SHA="$2"

    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or production"
        exit 1
    fi

    # Validate commit SHA format
    if [[ ! "$COMMIT_SHA" =~ ^[a-f0-9]{7,40}$ ]]; then
        log_error "Invalid commit SHA format: $COMMIT_SHA"
        exit 1
    fi

    # Validate S3 bucket is set
    if [[ -z "$S3_ARTIFACTS_BUCKET" ]]; then
        log_error "S3_ARTIFACTS_BUCKET environment variable is required"
        exit 1
    fi

    log_info "Validated inputs:"
    log_info "  Environment: $ENVIRONMENT"
    log_info "  Commit SHA: $COMMIT_SHA"
    log_info "  S3 Bucket: $S3_ARTIFACTS_BUCKET"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi

    # Check if jq is installed (for parsing JSON)
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed (required for parsing CDK outputs)"
        exit 1
    fi

    # Test AWS CLI access
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS CLI is not configured or credentials are invalid"
        exit 1
    fi

    # Check if CDK outputs file exists
    if [[ ! -f "$CDK_OUTPUT_FILE" ]]; then
        log_error "CDK outputs file not found: $CDK_OUTPUT_FILE"
        log_error "Make sure CDK deployment completed successfully"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Function to download build artifacts from S3
download_artifacts() {
    local artifacts_path="builds/$COMMIT_SHA"
    local local_dir="deployment-$TIMESTAMP"
    
    log_info "Downloading build artifacts from S3..."
    
    # Create temporary directory for artifacts
    mkdir -p "$local_dir"
    
    # Download artifacts
    if aws s3 ls "s3://$S3_ARTIFACTS_BUCKET/$artifacts_path/" > /dev/null 2>&1; then
        aws s3 sync "s3://$S3_ARTIFACTS_BUCKET/$artifacts_path/" "$local_dir/"
        log_success "Build artifacts downloaded to $local_dir"
    else
        log_error "Build artifacts not found in S3: s3://$S3_ARTIFACTS_BUCKET/$artifacts_path/"
        exit 1
    fi
    
    # Extract archives
    log_info "Extracting build artifacts..."
    
    # Extract backend
    if [[ -f "$local_dir/backend-${ENVIRONMENT}-${COMMIT_SHA}.tar.gz" ]]; then
        mkdir -p "$local_dir/backend"
        tar -xzf "$local_dir/backend-${ENVIRONMENT}-${COMMIT_SHA}.tar.gz" -C "$local_dir/backend/"
        log_success "Backend artifacts extracted"
    elif [[ -f "$local_dir/backend-${COMMIT_SHA}.tar.gz" ]]; then
        mkdir -p "$local_dir/backend"
        tar -xzf "$local_dir/backend-${COMMIT_SHA}.tar.gz" -C "$local_dir/backend/"
        log_success "Backend artifacts extracted"
    else
        log_warning "Backend artifacts not found"
    fi
    
    # Extract frontend
    if [[ -f "$local_dir/frontend-${ENVIRONMENT}-${COMMIT_SHA}.tar.gz" ]]; then
        mkdir -p "$local_dir/frontend"
        tar -xzf "$local_dir/frontend-${ENVIRONMENT}-${COMMIT_SHA}.tar.gz" -C "$local_dir/frontend/"
        log_success "Frontend artifacts extracted"
    elif [[ -f "$local_dir/frontend-${COMMIT_SHA}.tar.gz" ]]; then
        mkdir -p "$local_dir/frontend"
        tar -xzf "$local_dir/frontend-${COMMIT_SHA}.tar.gz" -C "$local_dir/frontend/"
        log_success "Frontend artifacts extracted"
    else
        log_warning "Frontend artifacts not found"
    fi
    
    echo "$local_dir"
}

# Function to parse CDK outputs
parse_cdk_outputs() {
    log_info "Parsing CDK outputs..."
    
    # Determine stack name based on environment
    local stack_name="aws-community-hub-${ENVIRONMENT}"
    
    # Extract key values from CDK outputs
    if jq -e ".\"$stack_name\"" "$CDK_OUTPUT_FILE" > /dev/null; then
        # API Gateway URL
        API_URL=$(jq -r ".\"$stack_name\".ApiUrl // empty" "$CDK_OUTPUT_FILE")
        
        # CloudFront Distribution URL
        APP_URL=$(jq -r ".\"$stack_name\".AppUrl // empty" "$CDK_OUTPUT_FILE")
        
        # Lambda Function Names
        BACKEND_FUNCTION_NAME=$(jq -r ".\"$stack_name\".BackendFunctionName // empty" "$CDK_OUTPUT_FILE")
        
        # S3 Bucket Names  
        FRONTEND_BUCKET=$(jq -r ".\"$stack_name\".FrontendBucket // empty" "$CDK_OUTPUT_FILE")
        
        log_success "CDK outputs parsed:"
        [[ -n "$API_URL" ]] && log_info "  API URL: $API_URL"
        [[ -n "$APP_URL" ]] && log_info "  App URL: $APP_URL"
        [[ -n "$BACKEND_FUNCTION_NAME" ]] && log_info "  Backend Function: $BACKEND_FUNCTION_NAME"
        [[ -n "$FRONTEND_BUCKET" ]] && log_info "  Frontend Bucket: $FRONTEND_BUCKET"
    else
        log_error "CDK outputs not found for stack: $stack_name"
        log_error "Available stacks in $CDK_OUTPUT_FILE:"
        jq -r 'keys[]' "$CDK_OUTPUT_FILE"
        exit 1
    fi
}

# Function to deploy backend
deploy_backend() {
    local artifacts_dir="$1"
    
    if [[ -z "$BACKEND_FUNCTION_NAME" ]]; then
        log_warning "No backend function name found, skipping backend deployment"
        return 0
    fi
    
    if [[ ! -d "$artifacts_dir/backend" ]]; then
        log_warning "No backend artifacts found, skipping backend deployment"
        return 0
    fi
    
    log_info "Deploying backend to Lambda function: $BACKEND_FUNCTION_NAME"
    
    # Create deployment package
    local deploy_package="backend-deploy-$TIMESTAMP.zip"
    
    cd "$artifacts_dir/backend"
    zip -r "../../$deploy_package" . > /dev/null
    cd "$PROJECT_ROOT"
    
    # Update Lambda function
    log_info "Updating Lambda function code..."
    aws lambda update-function-code \
        --function-name "$BACKEND_FUNCTION_NAME" \
        --zip-file "fileb://$deploy_package" \
        --region "$AWS_REGION" > /dev/null
    
    # Wait for function to be updated
    log_info "Waiting for function update to complete..."
    aws lambda wait function-updated \
        --function-name "$BACKEND_FUNCTION_NAME" \
        --region "$AWS_REGION"
    
    # Clean up deployment package
    rm -f "$deploy_package"
    
    log_success "Backend deployment completed"
}

# Function to deploy frontend
deploy_frontend() {
    local artifacts_dir="$1"
    
    if [[ -z "$FRONTEND_BUCKET" ]]; then
        log_warning "No frontend bucket found, skipping frontend deployment"
        return 0
    fi
    
    if [[ ! -d "$artifacts_dir/frontend" ]]; then
        log_warning "No frontend artifacts found, skipping frontend deployment"
        return 0
    fi
    
    log_info "Deploying frontend to S3 bucket: $FRONTEND_BUCKET"
    
    # Sync frontend files to S3
    aws s3 sync "$artifacts_dir/frontend/" "s3://$FRONTEND_BUCKET/" \
        --region "$AWS_REGION" \
        --delete \
        --cache-control "public, max-age=31536000, immutable" \
        --exclude "*.html" \
        --exclude "service-worker.js"
    
    # Upload HTML files with shorter cache control
    aws s3 sync "$artifacts_dir/frontend/" "s3://$FRONTEND_BUCKET/" \
        --region "$AWS_REGION" \
        --cache-control "public, max-age=0, must-revalidate" \
        --include "*.html" \
        --include "service-worker.js"
    
    # Invalidate CloudFront cache if we have a distribution
    local distribution_id=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='AWS Community Hub - $ENVIRONMENT'].Id | [0]" \
        --output text \
        --region "$AWS_REGION" 2>/dev/null || echo "")
    
    if [[ -n "$distribution_id" && "$distribution_id" != "None" ]]; then
        log_info "Invalidating CloudFront cache for distribution: $distribution_id"
        aws cloudfront create-invalidation \
            --distribution-id "$distribution_id" \
            --paths "/*" \
            --region "$AWS_REGION" > /dev/null
        log_success "CloudFront invalidation initiated"
    else
        log_warning "CloudFront distribution not found, skipping cache invalidation"
    fi
    
    log_success "Frontend deployment completed"
}

# Function to run post-deployment health checks
run_health_checks() {
    if [[ -z "$APP_URL" ]]; then
        log_warning "No app URL found, skipping health checks"
        return 0
    fi
    
    log_info "Running post-deployment health checks..."
    
    # Wait for deployment to propagate
    sleep 30
    
    # Basic health check
    local max_retries=10
    local retry_count=0
    local health_endpoint="${APP_URL}/health"
    
    while [[ $retry_count -lt $max_retries ]]; do
        if curl -f -s "$health_endpoint" > /dev/null 2>&1; then
            log_success "Health check passed: $health_endpoint"
            break
        else
            retry_count=$((retry_count + 1))
            log_warning "Health check failed, retrying... ($retry_count/$max_retries)"
            sleep 10
        fi
    done
    
    if [[ $retry_count -eq $max_retries ]]; then
        log_error "Health check failed after $max_retries attempts"
        return 1
    fi
    
    # API health check (if different from app URL)
    if [[ -n "$API_URL" && "$API_URL" != "$APP_URL" ]]; then
        local api_health_endpoint="${API_URL}/health"
        if curl -f -s "$api_health_endpoint" > /dev/null 2>&1; then
            log_success "API health check passed: $api_health_endpoint"
        else
            log_warning "API health check failed: $api_health_endpoint"
        fi
    fi
}

# Function to create deployment record
create_deployment_record() {
    local artifacts_dir="$1"
    local deployment_info_file="$artifacts_dir/deployment-info.json"
    
    log_info "Creating deployment record..."
    
    cat > "$deployment_info_file" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "environment": "$ENVIRONMENT",
  "commit_sha": "$COMMIT_SHA",
  "deployed_by": "\${USER:-unknown}",
  "app_url": "$APP_URL",
  "api_url": "$API_URL",
  "backend_function": "$BACKEND_FUNCTION_NAME",
  "frontend_bucket": "$FRONTEND_BUCKET",
  "deployment_id": "$TIMESTAMP"
}
EOF

    # Upload deployment record to S3
    aws s3 cp "$deployment_info_file" \
        "s3://$S3_ARTIFACTS_BUCKET/deployments/$ENVIRONMENT/latest.json" \
        --region "$AWS_REGION"
    
    aws s3 cp "$deployment_info_file" \
        "s3://$S3_ARTIFACTS_BUCKET/deployments/$ENVIRONMENT/$TIMESTAMP.json" \
        --region "$AWS_REGION"
    
    log_success "Deployment record created"
}

# Function to cleanup temporary files
cleanup() {
    local artifacts_dir="$1"
    
    if [[ -d "$artifacts_dir" ]]; then
        log_info "Cleaning up temporary files..."
        rm -rf "$artifacts_dir"
        log_success "Cleanup completed"
    fi
}

# Main deployment function
main() {
    log_info "Starting deployment to $ENVIRONMENT environment..."
    log_info "Commit SHA: $COMMIT_SHA"
    log_info "Timestamp: $TIMESTAMP"
    
    validate_inputs "$@"
    check_prerequisites
    
    # Download and extract artifacts
    local artifacts_dir
    artifacts_dir=$(download_artifacts)
    
    # Parse CDK outputs to get deployment targets
    parse_cdk_outputs
    
    # Deploy applications
    deploy_backend "$artifacts_dir"
    deploy_frontend "$artifacts_dir"
    
    # Run health checks
    if ! run_health_checks; then
        log_error "Health checks failed - deployment may have issues"
        cleanup "$artifacts_dir"
        exit 1
    fi
    
    # Create deployment record
    create_deployment_record "$artifacts_dir"
    
    # Cleanup
    cleanup "$artifacts_dir"
    
    log_success "✅ Deployment to $ENVIRONMENT completed successfully!"
    log_success "🌐 Application URL: ${APP_URL:-Not available}"
    log_success "🔗 API URL: ${API_URL:-Not available}"
    log_success "📦 Deployment ID: $TIMESTAMP"
}

# Handle script interruption
trap 'log_error "Deployment interrupted"; exit 130' INT TERM

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi