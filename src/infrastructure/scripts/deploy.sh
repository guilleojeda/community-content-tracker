#!/bin/bash

# Community Content Tracker - CDK Deployment Script
# This script deploys the infrastructure stacks in the correct order

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if AWS CLI is configured
check_aws_config() {
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        print_error "AWS CLI is not configured or credentials are invalid"
        print_error "Please run 'aws configure' or set up your AWS credentials"
        exit 1
    fi
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region)
    print_success "AWS configured for account: $ACCOUNT_ID in region: $REGION"
}

# Function to check if required tools are installed
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is required but not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is required but not installed"
        exit 1
    fi
    
    # Check AWS CDK
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is required but not installed"
        print_error "Install it with: npm install -g aws-cdk"
        exit 1
    fi
    
    print_success "All prerequisites are installed"
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    npm ci
    print_success "Dependencies installed"
}

# Function to bootstrap CDK (if needed)
bootstrap_cdk() {
    print_status "Checking CDK bootstrap status..."
    
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit > /dev/null 2>&1; then
        print_warning "CDK not bootstrapped. Bootstrapping..."
        cdk bootstrap
        print_success "CDK bootstrapped"
    else
        print_success "CDK already bootstrapped"
    fi
}

# Function to validate environment
validate_environment() {
    local env=$1
    
    if [[ "$env" != "dev" && "$env" != "staging" && "$env" != "prod" ]]; then
        print_error "Invalid environment: $env"
        print_error "Valid environments: dev, staging, prod"
        exit 1
    fi
    
    # Production safety check
    if [[ "$env" == "prod" ]]; then
        print_warning "Deploying to PRODUCTION environment!"
        read -p "Are you sure you want to continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^yes$ ]]; then
            print_error "Deployment cancelled"
            exit 1
        fi
    fi
    
    print_success "Environment validated: $env"
}

# Function to synthesize CDK
synthesize() {
    local env=$1
    
    print_status "Synthesizing CDK templates for $env environment..."
    cdk synth --context environment=$env
    print_success "CDK synthesis completed"
}

# Function to deploy stacks
deploy_stacks() {
    local env=$1
    local deploy_all=${2:-false}
    
    print_status "Starting deployment for $env environment..."
    
    if [[ "$deploy_all" == "true" ]]; then
        print_status "Deploying all stacks..."
        cdk deploy --all --context environment=$env --require-approval never
    else
        # Deploy stacks in order with dependencies
        print_status "Deploying Database stack..."
        cdk deploy "CommunityTracker-Database-$env" --context environment=$env --require-approval never
        
        print_status "Deploying Cognito stack..."
        cdk deploy "CommunityTracker-Cognito-$env" --context environment=$env --require-approval never
        
        print_status "Deploying API Gateway stack..."
        cdk deploy "CommunityTracker-ApiGateway-$env" --context environment=$env --require-approval never
    fi
    
    print_success "All stacks deployed successfully"
}

# Function to run diff
diff_stacks() {
    local env=$1
    
    print_status "Showing differences for $env environment..."
    cdk diff --context environment=$env
}

# Function to destroy stacks
destroy_stacks() {
    local env=$1
    
    print_warning "This will DESTROY all infrastructure for $env environment!"
    
    # Extra confirmation for production
    if [[ "$env" == "prod" ]]; then
        print_error "PRODUCTION DESTRUCTION REQUESTED!"
        read -p "Type 'DELETE PRODUCTION' to confirm: " -r
        if [[ "$REPLY" != "DELETE PRODUCTION" ]]; then
            print_error "Destruction cancelled"
            exit 1
        fi
    else
        read -p "Are you sure you want to destroy the $env environment? (yes/no): " -r
        if [[ ! $REPLY =~ ^yes$ ]]; then
            print_error "Destruction cancelled"
            exit 1
        fi
    fi
    
    print_status "Destroying stacks in reverse order..."
    
    # Destroy in reverse order
    cdk destroy "CommunityTracker-ApiGateway-$env" --context environment=$env --force
    cdk destroy "CommunityTracker-Cognito-$env" --context environment=$env --force
    cdk destroy "CommunityTracker-Database-$env" --context environment=$env --force
    
    print_success "All stacks destroyed"
}

# Function to show deployment status
show_status() {
    local env=$1
    
    print_status "Deployment status for $env environment:"
    
    # Check CloudFormation stacks
    aws cloudformation describe-stacks --query "Stacks[?contains(StackName, 'CommunityTracker') && contains(StackName, '$env')].{Name:StackName,Status:StackStatus}" --output table
    
    # Show outputs
    print_status "Stack outputs:"
    aws cloudformation describe-stacks --stack-name "CommunityTracker-Database-$env" --query "Stacks[0].Outputs" --output table 2>/dev/null || true
    aws cloudformation describe-stacks --stack-name "CommunityTracker-Cognito-$env" --query "Stacks[0].Outputs" --output table 2>/dev/null || true
    aws cloudformation describe-stacks --stack-name "CommunityTracker-ApiGateway-$env" --query "Stacks[0].Outputs" --output table 2>/dev/null || true
}

# Function to show help
show_help() {
    echo "Community Content Tracker - CDK Deployment Script"
    echo
    echo "Usage: $0 [COMMAND] [ENVIRONMENT] [OPTIONS]"
    echo
    echo "Commands:"
    echo "  deploy      Deploy the infrastructure stacks"
    echo "  destroy     Destroy the infrastructure stacks"
    echo "  diff        Show differences between current and deployed stacks"
    echo "  synth       Synthesize CDK templates"
    echo "  status      Show deployment status"
    echo "  help        Show this help message"
    echo
    echo "Environments:"
    echo "  dev         Development environment"
    echo "  staging     Staging environment"
    echo "  prod        Production environment"
    echo
    echo "Options:"
    echo "  --all       Deploy all stacks at once (faster but less granular)"
    echo "  --force     Skip confirmations (use with caution)"
    echo
    echo "Examples:"
    echo "  $0 deploy dev           Deploy to development"
    echo "  $0 deploy prod --all    Deploy all stacks to production"
    echo "  $0 diff staging         Show diff for staging"
    echo "  $0 destroy dev          Destroy development environment"
    echo "  $0 status prod          Show production status"
}

# Main script logic
main() {
    local command=$1
    local environment=$2
    local option=$3
    
    # Show help if no arguments
    if [[ $# -eq 0 ]]; then
        show_help
        exit 0
    fi
    
    # Handle help command
    if [[ "$command" == "help" ]]; then
        show_help
        exit 0
    fi
    
    # Check prerequisites for all commands except help
    check_prerequisites
    check_aws_config
    
    # Validate environment for commands that need it
    if [[ "$command" != "help" && -n "$environment" ]]; then
        validate_environment "$environment"
    fi
    
    # Change to the infrastructure directory
    cd "$(dirname "$0")/.."
    
    case $command in
        "deploy")
            if [[ -z "$environment" ]]; then
                print_error "Environment is required for deploy command"
                show_help
                exit 1
            fi
            install_dependencies
            bootstrap_cdk
            synthesize "$environment"
            
            if [[ "$option" == "--all" ]]; then
                deploy_stacks "$environment" true
            else
                deploy_stacks "$environment" false
            fi
            ;;
        
        "destroy")
            if [[ -z "$environment" ]]; then
                print_error "Environment is required for destroy command"
                show_help
                exit 1
            fi
            destroy_stacks "$environment"
            ;;
        
        "diff")
            if [[ -z "$environment" ]]; then
                print_error "Environment is required for diff command"
                show_help
                exit 1
            fi
            install_dependencies
            diff_stacks "$environment"
            ;;
        
        "synth")
            if [[ -z "$environment" ]]; then
                print_error "Environment is required for synth command"
                show_help
                exit 1
            fi
            install_dependencies
            synthesize "$environment"
            ;;
        
        "status")
            if [[ -z "$environment" ]]; then
                print_error "Environment is required for status command"
                show_help
                exit 1
            fi
            show_status "$environment"
            ;;
        
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
    
    print_success "Operation completed successfully!"
}

# Run the main function with all arguments
main "$@"