#!/bin/bash
# Deploy AWS Community Content Hub Infrastructure and Frontend
# This script builds the frontend and deploys all CDK stacks

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment from argument or default to dev
ENVIRONMENT=${1:-dev}
if [[ "$ENVIRONMENT" == "production" ]]; then
    ENVIRONMENT="prod"
fi

echo -e "${GREEN}Deploying AWS Community Content Hub - Environment: ${ENVIRONMENT}${NC}"
echo ""

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod|blue|green|beta)$ ]]; then
    echo -e "${RED}Error: Invalid environment. Must be dev, staging, prod, blue, green, or beta${NC}"
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

echo -e "${YELLOW}Step 1: Installing dependencies...${NC}"
npm install --workspaces

echo ""
echo -e "${YELLOW}Step 2: Building frontend...${NC}"
cd src/frontend
npm run build
cd ../..

echo ""
echo -e "${YELLOW}Step 3: Verifying frontend build output...${NC}"
if [ ! -d "src/frontend/out" ]; then
    echo -e "${RED}Error: Frontend build failed - output directory not found${NC}"
    exit 1
fi

FILE_COUNT=$(find src/frontend/out -type f | wc -l)
echo -e "${GREEN}Frontend build successful: ${FILE_COUNT} files generated${NC}"

echo ""
echo -e "${YELLOW}Step 4: Building CDK infrastructure...${NC}"
cd src/infrastructure
npm run build
cd ../..

echo ""
echo -e "${YELLOW}Step 5: Deploying CDK stacks...${NC}"
cd src/infrastructure
cdk deploy --all --context environment=${ENVIRONMENT} --require-approval never
cd ../..

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Retrieve CloudFront URL from stack outputs"
echo "2. Configure DNS if using custom domain"
echo "3. Update NEXT_PUBLIC_API_URL in frontend environment"
echo ""
echo -e "${GREEN}Run 'cdk deploy --all --context environment=${ENVIRONMENT}' from src/infrastructure to deploy updates${NC}"
