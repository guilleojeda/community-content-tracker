Architecture Decision Records (ADRs)
ADR-001: Overall Architecture Pattern
Status
Accepted
Context
We need a scalable, cost-effective architecture for a community platform with ~5,000 content creators and 1,000 daily searchers.
Decision
Adopt a serverless-first architecture with:

Frontend: Static Next.js site hosted on S3/CloudFront
API: AWS Lambda functions behind API Gateway
Database: Aurora Postgres Serverless v2 with pgvector
Authentication: AWS Cognito
Search: pgvector for semantic search, Postgres full-text search for keyword search
Content Ingestion: Scheduled Lambda functions with SQS for queue management
Infrastructure: AWS CDK for IaC

Consequences

Positive: Auto-scaling, pay-per-use, minimal operational overhead
Negative: Cold starts, vendor lock-in to AWS
Mitigation: Use Lambda reserved concurrency for critical paths


ADR-002: Test-Driven Development (TDD) Approach
Status
Accepted
Context
We need a robust testing strategy that ensures code quality while maintaining development velocity.
Decision
Implement behavior-driven TDD for all backend services following these principles:
Core Principles

Test Behavior, Not Implementation

Tests describe WHAT the system does, not HOW
No testing of private methods
Mock at architectural boundaries, not internal classes


Test Structure
typescriptdescribe('ContentIngestionService', () => {
  describe('when ingesting a blog post', () => {
    it('should extract metadata from RSS feed', async () => {
      // Arrange: Set up test data and mocks
      const rssFeed = createMockRssFeed();
      const mockFeedParser = createMockFeedParser(rssFeed);
      
      // Act: Execute behavior
      const result = await service.ingestContent(blogUrl);
      
      // Assert: Verify outcomes
      expect(result.title).toBe(expectedTitle);
      expect(result.contentType).toBe('blog');
    });
  });
});

Testing Layers

Unit Tests: Business logic in Lambda functions
Integration Tests: Database queries, external API calls
Contract Tests: API Gateway request/response contracts
E2E Tests: Critical user journeys only


Test Doubles Strategy
typescript// DO: Mock external dependencies
const mockS3Client = {
  getObject: jest.fn().mockResolvedValue(testData)
};

// DON'T: Mock internal implementation details
// Bad: jest.spyOn(service, '_parseContent')

Database Testing

Use test containers for Postgres with pgvector
Each test runs in a transaction that's rolled back
Seed data using factories, not fixtures


Testing Commands vs Queries

Commands: Verify state changes and side effects
Queries: Verify returned data structure and filtering



Implementation Guidelines
typescript// Example: Testing a content visibility change
describe('ContentService', () => {
  describe('updateContentVisibility', () => {
    it('should change content visibility when user owns the content', async () => {
      // Arrange
      const user = await createUser({ id: 'user-1' });
      const content = await createContent({ 
        ownerId: 'user-1', 
        visibility: 'private' 
      });
      
      // Act
      await contentService.updateVisibility(
        user.id, 
        content.id, 
        'public'
      );
      
      // Assert
      const updated = await contentRepository.findById(content.id);
      expect(updated.visibility).toBe('public');
    });
    
    it('should throw error when user does not own content', async () => {
      // Arrange
      const user = await createUser({ id: 'user-1' });
      const content = await createContent({ 
        ownerId: 'different-user',
        visibility: 'private'
      });
      
      // Act & Assert
      await expect(
        contentService.updateVisibility(user.id, content.id, 'public')
      ).rejects.toThrow('Unauthorized');
    });
  });
});
Test Execution Strategy

Run unit tests on every commit
Run integration tests on PR creation
Run E2E tests before deployment
Maintain >80% code coverage, 100% for business logic

Consequences

Positive: Refactoring confidence, living documentation, catch regressions early
Negative: Initial development slower, test maintenance overhead
Mitigation: Invest in good test utilities and factories


ADR-003: Database Design with pgvector
Status
Accepted
Context
We need to store content metadata, user information, and enable both keyword and semantic search.
Decision
Use Aurora Postgres Serverless v2 with pgvector extension:
Schema Design
sql-- Core tables
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  profile_slug VARCHAR(100) UNIQUE NOT NULL,
  default_visibility visibility_enum NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  content_type content_type_enum NOT NULL,
  visibility visibility_enum NOT NULL,
  publish_date TIMESTAMPTZ,
  capture_date TIMESTAMPTZ DEFAULT NOW(),
  metrics JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536), -- For semantic search
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE content_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  platform VARCHAR(50),
  is_primary BOOLEAN DEFAULT false
);

CREATE TABLE user_badges (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  badge_type badge_enum NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, badge_type)
);

-- Indexes
CREATE INDEX idx_content_embedding ON content 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_content_fulltext ON content 
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));

CREATE INDEX idx_content_visibility_user ON content(user_id, visibility);
CREATE INDEX idx_content_type_visibility ON content(content_type, visibility);
CREATE INDEX idx_content_tags ON content USING GIN(tags);
Vector Embedding Strategy

Use Amazon Titan via Amazon Bedrock for generating embeddings
Embed title + description for each content piece
Update embeddings when content metadata changes
Dimension: 1536 (compatible with common models)

Consequences

Positive: Powerful search capabilities, single database for all data
Negative: Requires pgvector maintenance, embedding computation costs
Mitigation: Cache embeddings, batch processing for updates


ADR-004: Content Ingestion Architecture
Status
Accepted
Context
We need to ingest content from multiple sources with different protocols and update frequencies.
Decision
Implement a modular ingestion pipeline:
Architecture
Source -> Lambda Scraper -> SQS -> Lambda Processor -> Database
                ↓
         CloudWatch Events
          (Daily Schedule)
Components

Source Adapters: One Lambda per content type

BlogScraperLambda: RSS/Atom feeds
YouTubeScraperLambda: YouTube Data API
GitHubScraperLambda: GitHub API


Message Queue: SQS for decoupling

Standard queue for cost optimization
DLQ for failed processing
Message attributes for content type routing


Content Processor: Single Lambda for all types

Deduplication logic
Embedding generation
Database persistence


Scheduling: CloudWatch Events

Daily runs for most sources
Configurable per source type



Implementation Example
typescript// Blog Scraper Lambda
export const handler = async (event: ScheduledEvent) => {
  const channels = await getActiveBlodChannels();
  
  for (const channel of channels) {
    const feedContent = await fetchRssFeed(channel.url);
    const newPosts = await filterNewContent(feedContent, channel.lastCheck);
    
    for (const post of newPosts) {
      await sqsClient.sendMessage({
        QueueUrl: process.env.PROCESSING_QUEUE_URL,
        MessageBody: JSON.stringify({
          type: 'blog',
          sourceUrl: channel.url,
          userId: channel.userId,
          content: {
            title: post.title,
            description: post.description,
            publishDate: post.pubDate,
            url: post.link
          }
        })
      });
    }
  }
};
Consequences

Positive: Scalable, fault-tolerant, source-agnostic processing
Negative: Eventual consistency, potential for duplicate processing
Mitigation: Idempotency keys, deduplication logic


ADR-005: Authentication and Authorization
Status
Accepted
Context
We need secure user authentication and granular content visibility controls.
Decision
Use AWS Cognito with custom attributes and Lambda authorizers:
Cognito Configuration
typescript{
  userPool: {
    signInAliases: ['email'],
    standardAttributes: {
      email: { required: true, mutable: false }
    },
    customAttributes: {
      'username': { dataType: 'String', mutable: true },
      'default_visibility': { dataType: 'String', mutable: true }
    },
    passwordPolicy: {
      minLength: 12,
      requireLowercase: true,
      requireUppercase: true,
      requireNumbers: true,
      requireSymbols: true
    },
    mfa: 'OPTIONAL',
    accountRecovery: 'EMAIL_ONLY'
  }
}
Authorization Model
typescript// Lambda Authorizer
export const handler = async (event: APIGatewayRequestAuthorizerEvent) => {
  const token = event.headers.Authorization;
  const decoded = await verifyToken(token);
  
  // Check badges for AWS-only content
  const badges = await getUserBadges(decoded.sub);
  
  return {
    principalId: decoded.sub,
    policyDocument: generatePolicy('Allow', event.methodArn),
    context: {
      userId: decoded.sub,
      email: decoded.email,
      badges: JSON.stringify(badges),
      isAwsProgram: badges.length > 0
    }
  };
};
Visibility Rules
typescriptenum Visibility {
  PRIVATE = 'private',           // Owner only
  AWS_ONLY = 'aws_only',         // Users with AWS badges
  AWS_COMMUNITY = 'aws_community', // Any registered user
  PUBLIC = 'public'              // Anyone including anonymous
}

// Content access logic
function canAccessContent(content: Content, user?: User): boolean {
  if (!user && content.visibility === Visibility.PUBLIC) return true;
  if (!user) return false;
  
  if (content.userId === user.id) return true;
  
  switch(content.visibility) {
    case Visibility.PUBLIC:
    case Visibility.AWS_COMMUNITY:
      return true;
    case Visibility.AWS_ONLY:
      return user.badges.length > 0;
    case Visibility.PRIVATE:
      return false;
  }
}
Consequences

Positive: Managed auth service, built-in MFA, scalable
Negative: Cognito limitations, vendor lock-in
Mitigation: Abstract auth logic for potential future migration


ADR-006: Search Implementation
Status
Accepted
Context
We need both keyword and semantic search capabilities across 50,000+ content pieces.
Decision
Implement hybrid search combining pgvector and Postgres full-text search:
Search Pipeline
typescriptinterface SearchParams {
  query: string;
  filters: {
    badges?: string[];
    contentTypes?: string[];
    dateRange?: { start: Date; end: Date };
    tags?: string[];
  };
  visibility: Visibility[];
  limit: number;
  offset: number;
}

async function hybridSearch(params: SearchParams): Promise<SearchResults> {
  // 1. Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(params.query);
  
  // 2. Perform parallel searches
  const [semanticResults, keywordResults] = await Promise.all([
    // Semantic search using pgvector
    db.query(`
      SELECT id, title, description, 
             1 - (embedding <=> $1::vector) as similarity
      FROM content
      WHERE visibility = ANY($2)
        AND ($3::text[] IS NULL OR tags && $3)
        AND ($4::text[] IS NULL OR content_type = ANY($4))
      ORDER BY embedding <=> $1::vector
      LIMIT $5
    `, [queryEmbedding, params.visibility, params.filters.tags, 
        params.filters.contentTypes, params.limit * 2]),
    
    // Full-text search
    db.query(`
      SELECT id, title, description,
             ts_rank(to_tsvector('english', title || ' ' || description),
                    plainto_tsquery('english', $1)) as rank
      FROM content
      WHERE to_tsvector('english', title || ' ' || description) 
            @@ plainto_tsquery('english', $1)
        AND visibility = ANY($2)
      ORDER BY rank DESC
      LIMIT $3
    `, [params.query, params.visibility, params.limit * 2])
  ]);
  
  // 3. Merge and re-rank results
  return mergeAndRankResults(semanticResults, keywordResults, params.limit);
}
Embedding Generation with Titan embeddings
typescriptasync function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    body: JSON.stringify({
      inputText: text,
      dimensions: 1536
    })
  }));
  
  return JSON.parse(response.body).embedding;
}
Consequences

Positive: Rich search experience, findability of relevant content
Negative: Complexity in ranking, embedding computation costs
Mitigation: Result caching, background embedding updates


ADR-007: GDPR Compliance
Status
Accepted
Context
We must comply with GDPR for our global user base.
Decision
Implement comprehensive data privacy controls:
Data Export
typescriptasync function exportUserData(userId: string): Promise<ExportPackage> {
  const userData = await db.transaction(async (trx) => {
    return {
      profile: await trx.query('SELECT * FROM users WHERE id = $1', [userId]),
      content: await trx.query('SELECT * FROM content WHERE user_id = $1', [userId]),
      contentUrls: await trx.query(`
        SELECT cu.* FROM content_urls cu
        JOIN content c ON cu.content_id = c.id
        WHERE c.user_id = $1
      `, [userId]),
      badges: await trx.query('SELECT * FROM user_badges WHERE user_id = $1', [userId])
    };
  });
  
  return {
    format: 'json',
    data: userData,
    exportedAt: new Date().toISOString(),
    dataRetentionPolicy: 'User data is retained until account deletion'
  };
}
Data Deletion
typescriptasync function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (trx) => {
    // Cascade delete handles related records
    await trx.query('DELETE FROM users WHERE id = $1', [userId]);
    
    // Audit log for compliance
    await trx.query(`
      INSERT INTO deletion_log (user_id, deleted_at, ip_address)
      VALUES ($1, NOW(), $2)
    `, [userId, requestIp]);
  });
  
  // Remove from Cognito
  await cognitoClient.adminDeleteUser({
    UserPoolId: process.env.USER_POOL_ID,
    Username: userId
  });
}
Privacy Controls

Consent tracking for data processing
Data minimization (only store necessary data)
Purpose limitation (clear usage statements)
Right to rectification (edit/update all personal data)
Privacy-by-design in all features

Consequences

Positive: Legal compliance, user trust, data portability
Negative: Development overhead, complex deletion logic
Mitigation: Automated compliance checks, clear data flows


ADR-008: Infrastructure as Code
Status
Accepted
Context
We need reproducible, version-controlled infrastructure deployment.
Decision
Use AWS CDK with TypeScript for all infrastructure:
Stack Structure
typescript// lib/stacks/database-stack.ts
export class DatabaseStack extends Stack {
  public readonly cluster: IServerlessCluster;
  
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    
    this.cluster = new ServerlessCluster(this, 'ContentHubDB', {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_15_3
      }),
      defaultDatabaseName: 'content_hub',
      enableDataApi: true,
      scaling: {
        autoPause: Duration.minutes(10),
        minCapacity: AuroraCapacityUnit.ACU_2,
        maxCapacity: AuroraCapacityUnit.ACU_16
      }
    });
    
    // Enable pgvector
    new CustomResource(this, 'PgVectorEnabler', {
      serviceToken: pgVectorEnablerLambda.functionArn,
      properties: {
        ClusterArn: this.cluster.clusterArn,
        SecretArn: this.cluster.secret?.secretArn
      }
    });
  }
}
Deployment Pipeline
yaml# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npx cdk deploy --all --require-approval never
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
Consequences

Positive: Type-safe infrastructure, AWS service integration, rollback capability
Negative: CDK learning curve, CloudFormation limitations
Mitigation: Comprehensive CDK patterns library, escape hatches for complex cases


ADR-009: Monitoring and Observability
Status
Accepted
Context
We need visibility into system health and user behavior with minimal overhead.
Decision
Use CloudWatch for all monitoring with structured logging:
Metrics Strategy
typescript// Custom metrics
const metrics = {
  contentIngested: new Metric({
    namespace: 'ContentHub',
    metricName: 'ContentIngested',
    dimensions: { ContentType: 'blog' }
  }),
  
  searchLatency: new Metric({
    namespace: 'ContentHub',
    metricName: 'SearchLatency',
    unit: Unit.MILLISECONDS
  }),
  
  apiErrors: new Metric({
    namespace: 'ContentHub',
    metricName: 'APIErrors',
    dimensions: { ErrorType: '4xx' }
  })
};

// Dashboards
new Dashboard(this, 'ContentHubDashboard', {
  widgets: [
    [
      new GraphWidget({
        title: 'Content Ingestion Rate',
        left: [metrics.contentIngested.with({ statistic: 'Sum', period: Duration.hours(1) })]
      }),
      new GraphWidget({
        title: 'Search Performance',
        left: [metrics.searchLatency.with({ statistic: 'Average' })],
        right: [metrics.searchLatency.with({ statistic: 'p99' })]
      })
    ]
  ]
});
Alarms
typescriptnew Alarm(this, 'HighErrorRate', {
  metric: metrics.apiErrors.with({
    statistic: 'Sum',
    period: Duration.minutes(5)
  }),
  threshold: 100,
  evaluationPeriods: 2,
  treatMissingData: TreatMissingData.NOT_BREACHING
});
Structured Logging
typescriptimport { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({
  serviceName: 'content-hub',
  logLevel: 'INFO'
});

// Usage
logger.info('Content ingested', {
  contentId: content.id,
  contentType: content.type,
  userId: user.id,
  source: channel.url,
  duration: processingTime
});
Consequences

Positive: Deep AWS integration, cost-effective, no additional services
Negative: Limited APM features, CloudWatch Insights learning curve
Mitigation: Structured logging standards, query templates