# Community Content Hub - Infrastructure

This directory contains the AWS CDK infrastructure code for the Community Content Hub application, covering all runtime stacks through Sprint 8.

## Architecture Overview

The infrastructure is composed of the following stacks (deployed in dependency order):

1. **DatabaseStack** - Aurora Serverless v2 (Postgres), RDS Proxy, and Valkey (ElastiCache Serverless)
2. **StaticSiteStack** - S3 + CloudFront frontend hosting (optional WAF)
3. **CognitoStack** - User Pool, custom attributes, and pre-signup Lambda
4. **QueueStack** - SQS queues and DLQs for ingestion
5. **ScraperStack** - RSS/YouTube/GitHub scrapers and content processor
6. **PublicApiStack** - Search + stats endpoints
7. **ApplicationApiStack** - Admin, analytics, exports, GDPR, and auth handlers
8. **ApiGatewayStack** - API Gateway with authorizer and route integrations
9. **MonitoringStack** - CloudWatch dashboards, alarms, and synthetic checks
10. **BlueGreenRoutingStack** (optional) - Weighted Route53 records for blue/green frontend rollouts

## Project Structure

```
src/infrastructure/
├── bin/
│   └── infrastructure.ts          # CDK app entry point
├── lib/
│   ├── stacks/
│   │   ├── ApplicationApiStack.ts
│   │   ├── ApiGatewayStack.ts
│   │   ├── BlueGreenRoutingStack.ts
│   │   ├── CognitoStack.ts
│   │   ├── DatabaseStack.ts
│   │   ├── MonitoringStack.ts
│   │   ├── PublicApiStack.ts
│   │   ├── QueueStack.ts
│   │   ├── ScraperStack.ts
│   │   └── static-site-stack.ts
│   └── config/environments.ts
├── scripts/
│   └── deploy.sh                  # Deployment automation script
└── README.md                      # This file
```

## Quick Start

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 18+ and npm
3. AWS CDK v2 installed globally: `npm install -g aws-cdk`

### Deployment

1. Install dependencies:
   ```bash
   cd src/infrastructure
   npm install
   ```

2. Deploy to development:
   ```bash
   ./scripts/deploy.sh deploy dev
   ```

3. Check deployment status:
   ```bash
   ./scripts/deploy.sh status dev
   ```

## Environments

- **dev**: Minimal resources for cost optimization
- **staging**: Production-like configuration for validation
- **beta**: Feature-flagged environment with beta features enabled
- **prod**: Production configuration with deletion protection and WAF
- **blue/green**: Production-like environments for blue/green rollouts

## Blue/Green Routing

Blue/green deployments use weighted Route53 records that point `BLUE_GREEN_DOMAIN_NAME` to the blue and green CloudFront distributions.

Required variables (or CDK context):
- `BLUE_GREEN_DOMAIN_NAME`
- `BLUE_GREEN_HOSTED_ZONE_ID`
- `BLUE_GREEN_HOSTED_ZONE_NAME`
- Optional weights: `BLUE_GREEN_WEIGHT_BLUE` / `BLUE_GREEN_WEIGHT_GREEN`

Example:
```bash
# Deploy blue and green environments
./scripts/deploy.sh deploy blue
./scripts/deploy.sh deploy green

# Deploy routing stack in prod
BLUE_GREEN_DOMAIN_NAME=app.example.com \
BLUE_GREEN_HOSTED_ZONE_ID=Z123456ABCDEFG \
BLUE_GREEN_HOSTED_ZONE_NAME=example.com \
BLUE_GREEN_WEIGHT_BLUE=10 \
BLUE_GREEN_WEIGHT_GREEN=90 \
cdk deploy CommunityContentHub-BlueGreenRouting-Prod --context environment=prod
```

## Manual CDK Commands

```bash
# List all stacks
cdk list --context environment=dev

# Deploy a specific stack
cdk deploy CommunityContentHub-Database-Dev --context environment=dev

# View generated CloudFormation
cdk synth --context environment=prod
```

## Notes

- Stack names are capitalized by environment (`Dev`, `Staging`, `Prod`, `Blue`, `Green`, `Beta`).
- Static site deployments use CloudFront response headers for CSP/HSTS/X-Frame-Options.
- CDN cache policies and Valkey caching are configured for production performance and rate limiting.
