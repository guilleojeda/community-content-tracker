# Database Infrastructure Setup - Task 1.4

## Overview
This document describes the Aurora Serverless v2 PostgreSQL database infrastructure implemented for the AWS Community Content Hub, including pgvector extension for vector similarity search.

## Architecture Components

### 1. Aurora Serverless v2 PostgreSQL Cluster
- **Engine**: PostgreSQL 15.4
- **Scaling**: 0.5-4 ACU (Aurora Capacity Units)
- **Features**: 
  - Automatic scaling based on demand
  - Point-in-time recovery (7-day retention)
  - Automated backups
  - CloudWatch logs integration

### 2. pgvector Extension
- **Purpose**: Vector similarity search for content recommendations
- **Implementation**: Custom Lambda function enables extension post-deployment
- **Embeddings**: Supports 1536-dimensional vectors (OpenAI ada-002 format)

### 3. RDS Proxy
- **Purpose**: Connection pooling and improved performance
- **Features**:
  - TLS encryption required
  - 1800-second idle timeout
  - Automatic failover support

### 4. Valkey Serverless Cache (ElastiCache)
- **Purpose**: API response caching and rate limiting
- **Deployment**: Valkey serverless cache in isolated subnets
- **Access**: Restricted to Lambda security group

### 5. Network Architecture
- **VPC**: 10.0.0.0/16 CIDR
- **Subnets**: 
  - 2 Public subnets (for NAT)
  - 2 Private subnets with egress (for scrapers that need internet access)
  - 2 Private isolated subnets (for database, proxy, Redis, and internal Lambdas)
- **Security**: Multiple security groups with least-privilege access
- **VPC Endpoints**: Interface and gateway endpoints for AWS services (SQS, Secrets Manager, Lambda, Bedrock, Cognito, CloudWatch, CloudWatch Logs, RDS Data API, SES, S3, DynamoDB)

### 6. Development Access
- **No bastion host**
- **Access**: Use RDS Data API / Query Editor for ad hoc queries
- **Local Development**: Prefer the local database for day-to-day work

## File Structure

```
src/infrastructure/
├── lib/
│   ├── stacks/
│   │   └── database-stack.ts          # Main database infrastructure
│   └── constructs/
│       └── pgvector-enabler.ts        # Custom pgvector enabler
├── bin/
│   └── infrastructure.ts              # CDK app entry point
└── jest.config.js                     # Test configuration

src/backend/database/
└── migrations/
    └── 001_initial_schema.sql         # Initial database schema

tests/infrastructure/
└── database-stack.test.ts             # Comprehensive CDK tests
```

## Database Schema

### Tables
1. **users** - User profiles and authentication
2. **content** - Community content with vector embeddings
3. **content_urls** - Associated URLs for content
4. **user_badges** - User achievements and recognition

### Key Features
- **Enums**: Visibility, ContentType, BadgeType matching TypeScript types
- **Indexes**: Optimized for vector similarity search and text search
- **Triggers**: Automatic timestamp updates
- **Functions**: Vector similarity search and user statistics

### Vector Search Capabilities
```sql
-- HNSW indexes for efficient vector similarity search
CREATE INDEX idx_content_embedding_cosine ON content 
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Search function for content recommendations
SELECT * FROM search_content_by_embedding($1, 0.8, 10, ARRAY['blog'], ARRAY['public']);
```

## Deployment Instructions

### Prerequisites
```bash
npm install -g aws-cdk
aws configure  # Ensure AWS credentials are set
```

### Deploy Database Stack
```bash
cd src/infrastructure

# Install dependencies
npm install

# Build the project
npm run build

# Deploy to development environment
npm run deploy:dev

# Deploy to production (with higher capacity and protection)
cdk deploy --context environment=prod
```

### Environment Configuration
- **Development**: 0.5-1 ACU, NAT enabled for scrapers, no bastion host
- **Production**: 1-4 ACU, deletion protection, extended backups

### Post-Deployment Setup
1. **Database Connection**: Use RDS Proxy endpoint for applications
2. **Schema Migration**: Run `001_initial_schema.sql` manually or via migration tool
3. **pgvector Extension**: Automatically enabled by custom resource

## Connection Examples

### Via RDS Data API (Query Editor or CLI)
```bash
aws rds-data execute-statement \
  --resource-arn <cluster-arn> \
  --secret-arn <secret-arn> \
  --database community_content \
  --sql "select 1;"
```

### Via RDS Proxy (Application)
```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.RDS_PROXY_ENDPOINT,
  port: 5432,
  database: 'community_content',
  user: 'postgres',
  password: '<from-secrets-manager>',
  ssl: { rejectUnauthorized: false }
});
```

## Security Features

### Network Security
- Database in private subnets only
- Security groups restrict access to specific ports/sources
- No direct internet access to database

### Authentication & Authorization
- Credentials stored in AWS Secrets Manager
- RDS Proxy manages connection authentication
- IAM roles for service access

### Encryption
- Encryption at rest (default for Aurora)
- TLS encryption in transit (enforced by RDS Proxy)
- Secrets Manager encrypts database credentials

## Monitoring & Logging

### CloudWatch Integration
- PostgreSQL logs exported to CloudWatch
- Custom metrics for Aurora Serverless scaling
- Database performance insights

### Alarms (To be implemented)
- High CPU utilization
- Connection count exceeded
- Storage usage thresholds
- Failed connection attempts

## Cost Optimization

### Aurora Serverless v2 Benefits
- Automatic scaling reduces idle costs
- Pay-per-second billing
- No pre-provisioning required

### Development Cost Savings
- Single NAT Gateway in dev environment
- Lower capacity limits
- Shorter backup retention

## Troubleshooting

### Common Issues
1. **pgvector Extension**: Check Lambda logs if extension fails to install
2. **Connection Timeouts**: Verify security group rules and VPC configuration
3. **Scaling Issues**: Monitor Aurora metrics and adjust capacity limits

### Useful Commands
```bash
# Check stack status
cdk diff
cdk synth

# View CloudFormation events
aws cloudformation describe-stack-events --stack-name <stack-name>

# Test database connectivity
telnet <rds-proxy-endpoint> 5432
```

## Testing

### CDK Tests
```bash
cd src/infrastructure
npm test
```

### Database Schema Tests
```bash
# Connect to database and run test queries
psql -h <endpoint> -U postgres -d community_content -f tests/database/schema-validation.sql
```

## Next Steps
1. Implement CloudWatch alarms and monitoring dashboards
2. Set up automated database migrations
3. Configure read replicas for production scaling
4. Implement database backup verification
5. Add performance testing and optimization

## Security Considerations
- Regular security patching via Aurora maintenance windows
- Periodic credential rotation via Secrets Manager
- Network access auditing and monitoring
- Database activity logging and analysis

## Performance Tuning
- Vector index optimization for large datasets
- Query performance monitoring
- Connection pooling configuration
- Aurora Serverless scaling patterns

---

**Implementation Status**: PASS Complete
**Sprint**: 1 
**Task**: 1.4 - Aurora Serverless Database Setup
**Dependencies**: Shared types (Task 1.1)
**Next Task**: API Gateway and Lambda setup (Task 1.5)
