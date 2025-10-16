# AWS Community Content Hub

An open-source platform that automates content tracking and reporting for AWS community contributors.

## Overview

The AWS Community Content Hub serves as a centralized repository for community-generated content, enabling contributors to manage their portfolio, AWS to track community contributions, and the broader community to discover experts and content.

## Features

- **Automated Content Discovery**: Ingests content from multiple sources (blogs, YouTube, GitHub)
- **Granular Visibility Controls**: Private, AWS-only, AWS+Community, and Public visibility levels
- **Semantic Search**: Vector-based similarity search using pgvector
- **Analytics & Reporting**: Personal dashboards and CSV exports for AWS programs
- **Public Profiles**: Showcase contributor portfolios
- **Badge System**: AWS program badge validation and display

## Architecture

This project uses a serverless-first architecture:

- **Frontend**: Next.js static site hosted on S3/CloudFront
- **API**: AWS Lambda functions behind API Gateway
- **Database**: Aurora Postgres Serverless v2 with pgvector
- **Authentication**: AWS Cognito
- **Infrastructure**: AWS CDK with TypeScript

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9.0.0+
- AWS CLI 2.x configured
- AWS CDK 2.1030.0+ (`npm install -g aws-cdk@latest`)
- Docker (for local database)
- PostgreSQL client (optional, for database debugging)

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd community-content-tracker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup local database**

   **Option A: Using Docker Compose (Recommended)**
   ```bash
   # Start PostgreSQL with pgvector using docker-compose
   docker-compose up -d

   # Verify database is running
   docker-compose ps

   # View logs if needed
   docker-compose logs postgres

   # Stop when done
   docker-compose down
   ```
   The compose file mounts `scripts/postgres/` into `/docker-entrypoint-initdb.d`, so the `contentuser` role (and matching password) is created automatically on first start.

   **Option B: Using Docker directly**
   ```bash
   # Start PostgreSQL (with pgvector pre-installed) using Docker
   docker run -d \
     --name content-hub-db \
     -e POSTGRES_USER=contentuser \
     -e POSTGRES_PASSWORD=localpassword \
     -e POSTGRES_DB=content_hub_dev \
     -p 5432:5432 \
     pgvector/pgvector:pg16

   # The pgvector extension ships with this image and is enabled by migrations
   ```

4. **Run database migrations**
   ```bash
   npm run db:migrate
   ```

5. **Start development servers**
   ```bash
   # Backend (Lambda emulator)
   npm run dev:backend

   # Frontend
   npm run dev:frontend
   ```

### Infrastructure Deployment

**Note**: This project is set up for local development. For AWS deployment:

1. **Configure AWS credentials**
   ```bash
   aws configure
   ```

2. **Install CDK CLI** (if not already installed)
   ```bash
   npm install -g aws-cdk@2.1030.0
   # Verify version
   cdk --version  # Should show 2.1030.0 or higher
   ```

3. **Bootstrap CDK** (one-time per AWS account/region)
   ```bash
   cd src/infrastructure
   npx cdk bootstrap
   ```

4. **Deploy infrastructure**
   ```bash
   npx cdk deploy --all
   ```

5. **Validate deployment**
   ```bash
   npx cdk synth --all
   ```

### Version Requirements

**Critical:** This project requires specific minimum versions to ensure compatibility:

- **AWS CDK CLI**: ≥ 2.1030.0 (required for schema version 48.0.0 support)
- **aws-cdk-lib**: ≥ 2.219.0
- **Node.js**: ≥ 18.0.0
- **npm**: ≥ 9.0.0

To check your installed versions:
```bash
cdk --version                  # Should show 2.1030.0+
npm list aws-cdk-lib aws-cdk   # In project root
node --version                 # Should show v18.x.x+
npm --version                  # Should show 9.x.x+
```

## Project Structure

```
├── src/
│   ├── backend/          # Lambda functions and services
│   ├── frontend/         # Next.js application
│   ├── shared/           # Shared types and utilities
│   └── infrastructure/   # CDK infrastructure code
├── tests/                # All test files
├── docs/                 # Documentation and ADRs
├── scripts/              # Build and deployment scripts
└── .env.development      # Local development configuration
```

## Testing

This project follows Test-Driven Development (TDD) with a minimum of 90% code coverage for frontend workspaces and comprehensive backend coverage.

```bash
# Run all workspace tests
npm test

# Backend tests
npm run test --workspace=src/backend
npm run test --workspace=src/backend -- --coverage

# Frontend tests
npm run test --workspace=src/frontend
npm run test --workspace=src/frontend -- --coverage
```

For Sprint 6.5 deliverables, refer to the [Documentation Review Checklist](docs/review-checklists/sprint_6_5_documentation_review.md) for the full set of required verification commands and environment references.

## Scripts

- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm run db:migrate` - Run database migrations for development
- `npm run db:seed` - Seed the development database
- `npm run dev:backend` - Start local backend server
- `npm run dev:frontend` - Start Next.js development server

## Environment Variables

Required environment variables are documented in `.env.example`. For local development:

```bash
# Copy template and configure your values
cp .env.example .env

# Frontend-specific variables
cp src/frontend/.env.template src/frontend/.env.local
```

**Backend requires:**
- `DATABASE_URL` - PostgreSQL connection string (default: postgresql://contentuser:localpassword@localhost:5432/content_hub_dev)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - Alternative to DATABASE_URL
- `AWS_REGION` - AWS services region (default: us-east-1)
- `COGNITO_USER_POOL_ID` - AWS Cognito user pool ID
- `COGNITO_CLIENT_ID` - AWS Cognito client ID
- `COGNITO_REGION` - AWS Cognito region (default: us-east-1)
- `CONTENT_PROCESSING_QUEUE_URL` - SQS queue URL for content processing
- `YOUTUBE_API_KEY` - YouTube Data API key (for YouTube scraper)
- `GITHUB_TOKEN` - GitHub personal access token (for GitHub scraper)
- `BEDROCK_MODEL_ID` - Amazon Bedrock model ID for embeddings (default: amazon.titan-embed-text-v1)

**Frontend requires:**
- `NEXT_PUBLIC_API_URL` - Backend API endpoint (required for production, defaults to http://localhost:3001 for development)
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID` - AWS Cognito user pool ID (optional)
- `NEXT_PUBLIC_COGNITO_CLIENT_ID` - AWS Cognito client ID (optional)
- `NEXT_PUBLIC_AWS_REGION` - AWS region (default: us-east-1)

**See `.env.example` for complete documentation of all 50+ configuration options, including:**
- Cache configuration (Redis/ElastiCache)
- Email settings (SES)
- External integrations (Stripe, OpenAI, etc.)
- Monitoring (CloudWatch, X-Ray, Sentry)
- Feature flags
- Security and compliance settings

Never commit real AWS credentials or API keys to version control.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Performance Targets

- Support 5,000 registered users
- Handle 1,000 daily active searchers
- Process ~50,000 content pieces
- Search response time <500ms (p95)
- Content ingestion <2 hours from publish

## Security & Compliance

- GDPR compliant with data portability and right to erasure
- Secure authentication via AWS Cognito
- Granular permission model for content visibility
- CloudWatch monitoring for system health

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
## Verification Checklist

Before opening a pull request or shipping an increment, ensure the following commands succeed locally:

```bash
npm run db:migrate
npm run test --workspace=src/backend
npm run test --workspace=src/frontend -- --coverage
npm run typecheck
npm run build
npm run synth --workspace=src/infrastructure
npm audit
```

These commands rely on the environment variables documented in `.env`. Environment validation will fail fast if required values are missing.

## Documentation Review Checklist

- [x] Reviewed by Codex Agent (2025-10-14)

## Support

- Documentation: [docs/](docs/)
- Bug Reports: [Issues](https://github.com/your-org/community-content-tracker/issues)
- Discussions: [GitHub Discussions](https://github.com/your-org/community-content-tracker/discussions)
