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

- Node.js 18+
- AWS CLI configured
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
   ```bash
   # Start PostgreSQL with Docker
   docker run -d \
     --name content-hub-db \
     -e POSTGRES_PASSWORD=localpassword \
     -e POSTGRES_DB=content_hub_dev \
     -p 5432:5432 \
     postgres:15-alpine
   
   # Install pgvector extension (will be handled by migrations)
   ```

4. **Run database migrations**
   ```bash
   npm run migrate:dev
   ```

5. **Start development servers**
   ```bash
   # Backend (API Gateway emulation)
   npm run dev:api

   # Frontend
   npm run dev:web
   ```

### Infrastructure Deployment

**Note**: This project is set up for local development. For AWS deployment:

1. **Configure AWS credentials**
   ```bash
   aws configure
   ```

2. **Bootstrap CDK** (one-time per AWS account/region)
   ```bash
   cd src/infrastructure
   npx cdk bootstrap
   ```

3. **Deploy infrastructure**
   ```bash
   npx cdk deploy --all
   ```

4. **Validate deployment**
   ```bash
   npx cdk synth
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

This project follows Test-Driven Development (TDD) with >80% code coverage requirement:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Scripts

- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm run migrate:dev` - Run database migrations for development
- `npm run dev:api` - Start local API server
- `npm run dev:web` - Start Next.js development server

## Environment Variables

Copy `.env.development` for local development. See that file for all required environment variables.

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

## Support

- 📖 Documentation: [docs/](docs/)
- 🐛 Bug Reports: [Issues](https://github.com/your-org/community-content-tracker/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/your-org/community-content-tracker/discussions)

---

Built with ❤️ for the AWS Community