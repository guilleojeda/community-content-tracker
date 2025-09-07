# Local Development Setup Guide

This guide will walk you through setting up the AWS Community Content Hub development environment on your local machine.

## Prerequisites

Before starting, ensure you have the following installed:

### Required Software

1. **Node.js** (v18 or higher)
   ```bash
   # Check version
   node --version
   npm --version
   
   # Install via nvm (recommended)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 18
   nvm use 18
   ```

2. **Docker** and **Docker Compose**
   ```bash
   # Check installation
   docker --version
   docker-compose --version
   ```

3. **AWS CLI** (v2)
   ```bash
   # Install on macOS
   curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
   sudo installer -pkg AWSCLIV2.pkg -target /
   
   # Install on Linux
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   
   # Verify installation
   aws --version
   ```

4. **AWS CDK CLI**
   ```bash
   npm install -g aws-cdk
   cdk --version
   ```

5. **Git**
   ```bash
   git --version
   ```

### Optional but Recommended

- **VS Code** with recommended extensions (see extensions.json)
- **Postman** or **Insomnia** for API testing
- **pgAdmin** for PostgreSQL database management

## Project Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd community-content-tracker
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install backend dependencies
cd src/backend
npm install

# Install frontend dependencies (when implemented)
cd ../frontend
npm install

# Return to root
cd ../..
```

### 3. Environment Configuration

Copy the environment template and configure your settings:

```bash
cp .env.example .env
```

Edit the `.env` file with your specific configuration (see [AWS Prerequisites](./aws-prerequisites.md) for AWS-specific settings).

### 4. Database Setup

Start the local PostgreSQL database using Docker:

```bash
# Start database
docker-compose up -d postgres

# Wait for database to be ready
docker-compose logs -f postgres

# Run migrations
npm run db:migrate

# Seed test data (optional)
npm run db:seed
```

### 5. AWS Configuration

Configure your AWS credentials:

```bash
aws configure
```

You'll need:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., us-east-1)
- Default output format (json)

### 6. CDK Bootstrap (First Time Only)

Bootstrap your AWS environment for CDK:

```bash
cdk bootstrap
```

## Development Workflow

### Starting the Development Environment

```bash
# Start all services
docker-compose up -d

# Start backend in development mode
cd src/backend
npm run dev

# In another terminal, start frontend (when available)
cd src/frontend
npm run dev
```

### Running Tests

```bash
# Run all tests
npm test

# Run backend tests only
cd src/backend
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

### Database Operations

```bash
# Create new migration
npm run db:migration:generate -- --name="migration-name"

# Run migrations
npm run db:migrate

# Rollback last migration
npm run db:migrate:down

# Reset database
npm run db:reset
```

### CDK Operations

```bash
# Deploy infrastructure
npm run deploy

# View infrastructure diff
npm run cdk:diff

# Destroy infrastructure (be careful!)
npm run cdk:destroy
```

## Code Quality

### Linting and Formatting

```bash
# Run ESLint
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format

# Type checking (TypeScript)
npm run type-check
```

### Pre-commit Hooks

The project uses Husky for pre-commit hooks:

```bash
# Install pre-commit hooks
npm run prepare
```

This will automatically:
- Run linting
- Run type checking
- Run tests
- Format code

## Environment Validation

### Health Checks

```bash
# Check backend health
curl http://localhost:3000/health

# Check database connection
npm run db:check

# Validate AWS connection
aws sts get-caller-identity
```

### Port Usage

Default ports used by the application:

- **3000**: Backend API server
- **3001**: Frontend development server (when available)
- **5432**: PostgreSQL database
- **6379**: Redis (if used for caching)

Make sure these ports are available or configure different ports in your `.env` file.

## Development Tools

### Recommended VS Code Extensions

The project includes a `.vscode/extensions.json` file with recommended extensions. VS Code will prompt you to install them automatically.

### Database Management

Access your local database:

```bash
# Using psql
docker-compose exec postgres psql -U contentuser -d contenthub

# Using pgAdmin (web interface)
# Navigate to http://localhost:8080
```

### API Testing

Example API requests:

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test authentication (when implemented)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

## Debugging

### Backend Debugging

For VS Code debugging, use the provided launch configuration:

1. Set breakpoints in your TypeScript code
2. Press F5 or go to Run and Debug
3. Select "Debug Backend"

### Database Debugging

```bash
# View database logs
docker-compose logs postgres

# Connect to database for manual queries
docker-compose exec postgres psql -U contentuser -d contenthub

# View all tables
\dt

# View table structure
\d table_name
```

### AWS Debugging

```bash
# Check CloudFormation stack status
aws cloudformation describe-stacks --stack-name CommunityContentHub

# View CloudWatch logs
aws logs describe-log-groups
aws logs tail /aws/lambda/function-name --follow
```

## Common Commands Cheat Sheet

```bash
# Start development environment
npm run dev

# Run tests
npm test

# Database operations
npm run db:migrate
npm run db:reset
npm run db:seed

# AWS operations
npm run deploy
npm run cdk:diff

# Code quality
npm run lint
npm run format
npm run type-check

# Cleanup
docker-compose down
npm run clean
```

## Next Steps

1. Read the [AWS Prerequisites](./aws-prerequisites.md) guide
2. Review the [Troubleshooting](./troubleshooting.md) guide
3. Check out the [Database Migrations](./database-migrations.md) documentation
4. Explore the project structure and start coding!

## Getting Help

- Check the [Troubleshooting Guide](./troubleshooting.md) for common issues
- Review the project's README.md for additional information
- Check existing GitHub issues
- Create a new issue if you encounter problems not covered in the documentation