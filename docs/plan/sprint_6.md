AWS Community Content Hub - Complete Implementation Plan (Revised)
Project Overview

Duration: 16 weeks (8 sprints of 2 weeks each)
Development Approach: Test-Driven Development (TDD)
Team Structure: Assuming 2-3 developers using AI assistance
Definition of Done: Code complete, unit tests passing (>80% coverage), integration tests passing, code reviewed, documentation updated, deployed to dev environment


Sprint 1: Foundation Setup
Goal: Establish development environment and core infrastructure
Task 1.1: Project Repository Setup
Epic: E1
Story Points: 2
Dependencies: None
User Story: As a developer, I want a well-structured repository so that I can efficiently develop and maintain the application.
Acceptance Criteria:

 GitHub repository created with proper .gitignore for Node.js/TypeScript
 Branch protection rules configured (main branch protected, PR required)
 README.md with project overview and setup instructions
 CONTRIBUTING.md with development guidelines
 LICENSE file (MIT or Apache 2.0)
 Code of Conduct established

Technical Details:
Repository Structure:
├── packages/
│   ├── backend/        # Lambda functions
│   ├── frontend/       # Next.js application
│   ├── shared/         # Shared types and utilities
│   └── infrastructure/ # CDK code
├── docs/              # ADRs and documentation
├── scripts/           # Build and deployment scripts
└── tests/            # E2E tests
Task 1.2: CDK Infrastructure Bootstrap
Epic: E1
Story Points: 3
Dependencies: Task 1.1
User Story: As a developer, I want CDK infrastructure initialized so that I can deploy AWS resources.
Acceptance Criteria:

 CDK app initialized with TypeScript
 Base stack structure created
 Environment configuration (dev/staging/prod)
 CDK bootstrap completed for target AWS account
 Basic parameter store setup for configuration
 Cost tags configured for all resources

Implementation Notes:
typescript// infrastructure/lib/app.ts
const app = new App();

const envDev = { account: process.env.AWS_ACCOUNT, region: 'us-east-1' };

new ContentHubStack(app, 'ContentHub-Dev', {
  env: envDev,
  stage: 'dev'
});
Task 1.3: CI/CD Pipeline Setup
Epic: E1
Story Points: 5
Dependencies: Task 1.2
User Story: As a team, we want automated CI/CD so that code changes are tested and deployed consistently.
Acceptance Criteria:

 GitHub Actions workflow for PR validation (lint, test, build)
 Automated deployment to dev on main branch merge
 Manual approval for staging/prod deployments
 Secret management via GitHub Secrets
 Build artifacts stored in S3
 Deployment notifications to Slack/Discord (optional)

Workflow Configuration:
yamlname: CI/CD Pipeline
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - lint
      - unit tests
      - integration tests
      - security scan
  
  deploy-dev:
    if: github.ref == 'refs/heads/main'
    needs: test
    steps:
      - cdk deploy
Task 1.4: Aurora Serverless Database Setup
Epic: E3
Story Points: 5
Dependencies: Task 1.2
User Story: As a developer, I want the database infrastructure ready so that I can start implementing data persistence.
Acceptance Criteria:

 Aurora Serverless v2 Postgres cluster deployed
 pgvector extension enabled via custom resource
 Database secrets stored in Secrets Manager
 VPC and security groups properly configured
 Database proxy configured for connection pooling
 Dev database accessible via RDS Data API (no bastion host)
 Automated backup configuration with 7-day retention
 Point-in-time recovery enabled

Verification Query:
sqlSELECT version();
SELECT * FROM pg_extension WHERE extname = 'vector';
SHOW backup_retention_period;
Task 1.5: Static Site Infrastructure Setup
Epic: E1
Story Points: 5
Dependencies: Task 1.2
User Story: As a developer, I want the frontend hosting infrastructure ready so that the Next.js app can be deployed.
Acceptance Criteria:

 S3 bucket for static site hosting configured
 CloudFront distribution created
 Route53 hosted zone setup
 SSL certificate via ACM configured
 Custom domain connected
 Environment-specific subdomains (dev.domain.com, staging.domain.com)
 Origin Access Identity for S3
 Cache behaviors configured for static vs dynamic content

CDK Configuration:
typescriptconst staticSiteBucket = new s3.Bucket(this, 'StaticSite', {
  websiteIndexDocument: 'index.html',
  publicReadAccess: false,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
});

const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(staticSiteBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
  },
  domainNames: [props.domainName],
  certificate: certificate
});
Task 1.6: Development Environment Documentation
Epic: E1
Story Points: 2
Dependencies: Tasks 1.1-1.5
User Story: As a new developer, I want clear setup instructions so that I can start contributing quickly.
Acceptance Criteria:

 Local development setup guide complete
 AWS account prerequisites documented
 Environment variable template (.env.example)
 Troubleshooting guide for common issues
 Database migration instructions
 VS Code recommended extensions listed
 First-time setup script created


Sprint 2: Authentication & Data Layer
Goal: Implement user authentication and core database functionality
Task 2.1: Cognito User Pool Setup
Epic: E2
Story Points: 3
Dependencies: Task 1.2
User Story: As a user, I want to create an account so that I can track my content.
Acceptance Criteria:

 Cognito User Pool created with email sign-in
 Custom attributes for username, default_visibility, and is_admin
 Email verification enabled
 Password policy configured (min 12 chars, complexity requirements)
 MFA optional but available
 Pre-signup Lambda for username validation
 Admin user group created

Verification Test:
typescripttest('should create user with valid email and username', async () => {
  const result = await cognito.signUp({
    Username: 'test@example.com',
    Password: 'TestPassword123!',
    UserAttributes: [
      { Name: 'email', Value: 'test@example.com' },
      { Name: 'custom:username', Value: 'testuser' },
      { Name: 'custom:is_admin', Value: 'false' }
    ]
  });
  expect(result.UserSub).toBeDefined();
});
Task 2.2: Database Schema Implementation
Epic: E3
Story Points: 5
Dependencies: Task 1.4
User Story: As a developer, I want the database schema implemented so that I can store application data.
Acceptance Criteria:

 All tables created as per ADR-003
 Enums for visibility, content_type (including 'conference_talk' and 'podcast'), and badge_type
 AWS employee flag in users table
 Indexes for performance optimization
 Foreign key constraints properly set
 Migration system implemented (e.g., Flyway, node-pg-migrate)
 Seed data script for development including test admin user

Migration Script:
sql-- 001_initial_schema.sql
CREATE TYPE visibility_enum AS ENUM ('private', 'aws_only', 'aws_community', 'public');
CREATE TYPE content_type_enum AS ENUM ('blog', 'youtube', 'github', 'conference_talk', 'podcast');
CREATE TYPE badge_enum AS ENUM ('community_builder', 'hero', 'ambassador', 'user_group_leader');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  profile_slug VARCHAR(100) UNIQUE NOT NULL,
  default_visibility visibility_enum NOT NULL DEFAULT 'private',
  is_admin BOOLEAN DEFAULT false,
  is_aws_employee BOOLEAN DEFAULT false,
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
  embedding vector(1536),
  is_claimed BOOLEAN DEFAULT true,
  original_author VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Continue with all tables...
Task 2.3: Database Repository Layer
Epic: E3
Story Points: 8
Dependencies: Task 2.2
User Story: As a developer, I want a repository pattern implementation so that I can interact with the database consistently.
Acceptance Criteria:

 BaseRepository with common CRUD operations
 UserRepository with user-specific queries including admin checks
 ContentRepository with visibility filtering
 BadgeRepository for badge management
 Transaction support for complex operations
 Connection pooling configured
 Unit tests with test containers

Test Example:
typescriptdescribe('UserRepository', () => {
  test('should identify admin users', async () => {
    const admin = await repo.create({
      cognitoSub: 'sub-admin',
      email: 'admin@example.com',
      username: 'admin',
      isAdmin: true
    });
    
    const isAdmin = await repo.isAdmin(admin.id);
    expect(isAdmin).toBe(true);
  });
});
Task 2.4: Authentication Lambda Functions
Epic: E2
Story Points: 5
Dependencies: Tasks 2.1, 2.3
User Story: As an API, I need to authenticate and authorize requests so that I can protect user data.
Acceptance Criteria:

 JWT token verification Lambda
 User context enrichment with badges and admin status
 API Gateway authorizer configured
 Token refresh handling
 Rate limiting per user
 Admin-only endpoint protection
 Comprehensive error handling

Authorizer Test:
typescripttest('should include admin status in context', async () => {
  const adminUser = await createAdminUser();
  const token = await generateValidToken(adminUser);
  const result = await authorizer.handler({
    authorizationToken: `Bearer ${token}`,
    methodArn: 'arn:aws:execute-api:*'
  });
  
  expect(JSON.parse(result.context.isAdmin)).toBe(true);
});
Task 2.5: User Registration & Login APIs
Epic: E2
Story Points: 5
Dependencies: Tasks 2.1, 2.3, 2.4
User Story: As a user, I want to register and log in so that I can access my account.
Acceptance Criteria:

 POST /auth/register endpoint
 POST /auth/login endpoint
 POST /auth/refresh endpoint
 GET /auth/verify-email endpoint
 Username uniqueness validation
 Profile slug auto-generation
 Integration tests for full flow

API Contract:
typescriptPOST /auth/register
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "username": "johndoe"
}

Response: 201
{
  "userId": "uuid",
  "message": "Please check your email to verify your account"
}
Task 2.6: Admin Bootstrap Script
Epic: E2
Story Points: 2
Dependencies: Tasks 2.2, 2.3
User Story: As a system operator, I need to create the first admin user so that I can manage the platform.
Acceptance Criteria:

 CLI script to create first admin user
 Bypass email verification for first admin
 Set is_admin flag in database
 Add to admin group in Cognito
 Idempotent (safe to run multiple times)
 Environment-specific configuration

Script Example:
bashnpm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!

Sprint 3: Content Management Core
Goal: Implement basic content CRUD operations
Task 3.1: Content Management API - Create
Epic: E4
Story Points: 5
Dependencies: Tasks 2.3, 2.4
User Story: As a user, I want to manually add content so that I can track my contributions.
Acceptance Criteria:

 POST /content endpoint implemented
 Visibility defaults to user's preference
 Content type validation (including conference_talk and podcast)
 URL deduplication check
 Tags properly stored as array
 Owner verification via JWT
 Support for unclaimed content (is_claimed = false, original_author field)
 Response includes created content with ID

Test Case:
typescripttest('should create unclaimed content for later claiming', async () => {
  const adminToken = await getAdminAuthToken();
  
  const response = await api.post('/content')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'AWS re:Invent Keynote',
      contentType: 'conference_talk',
      urls: ['https://youtube.com/watch?v=keynote'],
      originalAuthor: 'Werner Vogels',
      isClaimed: false
    });
  
  expect(response.body.isClaimed).toBe(false);
  expect(response.body.originalAuthor).toBe('Werner Vogels');
});
Task 3.2: Content Management API - Read
Epic: E4
Story Points: 3
Dependencies: Task 3.1
User Story: As a user, I want to view my content so that I can manage my portfolio.
Acceptance Criteria:

 GET /content endpoint (list user's content)
 GET /content/:id endpoint (single content)
 GET /content/unclaimed endpoint (list unclaimed content for claiming)
 Pagination support (limit/offset)
 Sorting by date, title
 Visibility filtering respected
 Include all URLs for each content
 404 for non-existent content

Task 3.3: Content Management API - Update
Epic: E4
Story Points: 3
Dependencies: Task 3.1
User Story: As a user, I want to update my content so that I can keep information current.
Acceptance Criteria:

 PUT /content/:id endpoint
 Only owner can update (or admin)
 Visibility can be changed
 Tags can be modified
 Updated timestamp tracked
 Optimistic locking for concurrent updates
 403 for non-owner attempts

Task 3.4: Content Management API - Delete
Epic: E4
Story Points: 2
Dependencies: Task 3.1
User Story: As a user, I want to delete my content so that I can remove outdated items.
Acceptance Criteria:

 DELETE /content/:id endpoint
 Only owner can delete (or admin)
 Cascade delete for content_urls
 Soft delete option for audit trail
 204 No Content on success
 403 for non-owner attempts

Task 3.5: Content Claiming API
Epic: E4
Story Points: 5
Dependencies: Tasks 3.1, 3.2
User Story: As a user, I want to claim my unclaimed content so that it appears in my portfolio.
Acceptance Criteria:

 POST /content/:id/claim endpoint
 Verify user identity matches original_author (flexible matching)
 Update is_claimed flag and set user_id
 Admin override capability
 Bulk claim endpoint for multiple items
 Notification to admin for review (optional)

Test Case:
typescripttest('should allow user to claim matching content', async () => {
  const unclaimedContent = await createUnclaimedContent({
    originalAuthor: 'John Doe'
  });
  
  const user = await createUser({ username: 'johndoe' });
  const token = await getAuthToken(user);
  
  await api.post(`/content/${unclaimedContent.id}/claim`)
    .set('Authorization', `Bearer ${token}`);
  
  const claimed = await contentRepo.findById(unclaimedContent.id);
  expect(claimed.userId).toBe(user.id);
  expect(claimed.isClaimed).toBe(true);
});
Task 3.6: Badge Management API
Epic: E2
Story Points: 5
Dependencies: Task 2.3
User Story: As an admin, I want to manage user badges and AWS employee status so that users are properly identified.
Acceptance Criteria:

 POST /admin/badges endpoint (grant badge)
 DELETE /admin/badges endpoint (revoke badge)
 PUT /admin/users/:id/aws-employee endpoint (mark as AWS employee)
 GET /users/:id/badges endpoint (public)
 Badge history tracking
 Bulk operations support
 Admin authentication required

Badge Grant Test:
typescripttest('should mark user as AWS employee', async () => {
  const admin = await createAdminUser();
  const user = await createTestUser();
  
  await api.put(`/admin/users/${user.id}/aws-employee`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isAwsEmployee: true });
  
  const updated = await userRepo.findById(user.id);
  expect(updated.isAwsEmployee).toBe(true);
});
Task 3.7: Content Merge API
Epic: E4
Story Points: 5
Dependencies: Tasks 3.1, 3.2
User Story: As a user, I want to merge duplicate content so that my portfolio is clean.
Acceptance Criteria:

 POST /content/merge endpoint
 Merge two or more content items
 Combine URLs from all items
 Preserve earliest publish date
 Keep best metadata (most complete)
 Audit trail of merge operations
 Undo capability within 30 days

Merge Test:
typescripttest('should merge duplicate content items', async () => {
  const content1 = await createContent({ 
    title: 'AWS Lambda Tutorial',
    urls: ['https://blog1.com/lambda']
  });
  const content2 = await createContent({ 
    title: 'AWS Lambda Tutorial',
    urls: ['https://medium.com/@user/lambda']
  });
  
  const merged = await api.post('/content/merge')
    .send({ contentIds: [content1.id, content2.id], primaryId: content1.id });
  
  expect(merged.body.urls).toHaveLength(2);
});

Sprint 4: Content Ingestion Pipeline
Goal: Implement automated content scraping
Task 4.1: SQS Queue Infrastructure
Epic: E5
Story Points: 3
Dependencies: Task 1.2
User Story: As a system, I need message queues so that I can process content asynchronously.
Acceptance Criteria:

 Content processing queue created
 Dead letter queue configured
 Message retention set to 14 days
 Visibility timeout appropriate for processing
 CloudWatch alarms for DLQ messages
 Message attributes for routing

Task 4.2: Blog RSS Scraper
Epic: E5
Story Points: 8
Dependencies: Tasks 4.1, 2.3
User Story: As a user, I want my blog automatically tracked so that I don't need to add each post manually.
Acceptance Criteria:

 Lambda function to parse RSS/Atom feeds
 Support for common blog platforms
 Extract title, description, date, URL
 Handle malformed feeds gracefully
 Send new posts to SQS queue
 Track last check timestamp per channel
 CloudWatch scheduled trigger

Task 4.3: YouTube Channel Scraper
Epic: E5
Story Points: 5
Dependencies: Tasks 4.1, 2.3
User Story: As a user, I want my YouTube videos tracked so that my video content is included.
Acceptance Criteria:

 YouTube Data API v3 integration
 Extract video metadata
 Handle API quotas gracefully
 Support channel and playlist URLs
 Pagination for large channels
 API key stored in Secrets Manager

Task 4.4: GitHub Repository Scraper
Epic: E5
Story Points: 5
Dependencies: Tasks 4.1, 2.3
User Story: As a user, I want my GitHub repos tracked so that my code contributions are visible.
Acceptance Criteria:

 GitHub API integration
 Extract repo metadata and README
 Support for organizations
 Handle rate limiting
 Track stars, forks, language
 Filter by topic/language (optional)

Task 4.5: Content Processor Lambda
Epic: E5
Story Points: 8
Dependencies: Tasks 4.1-4.4, 5.1
User Story: As a system, I need to process scraped content so that it's properly stored and indexed.
Acceptance Criteria:

 SQS message consumer
 Content deduplication logic
 Generate embeddings via Bedrock
 Store in database with user association
 Handle duplicate URLs
 Update embeddings when content changes
 Error handling with retry
 Metrics for processing rate

Task 4.6: Channel Management API
Epic: E5
Story Points: 5
Dependencies: Task 2.3
User Story: As a user, I want to manage my content channels so that automated tracking works correctly.
Acceptance Criteria:

 POST /channels endpoint (add channel)
 GET /channels endpoint (list channels)
 DELETE /channels/:id endpoint
 PUT /channels/:id endpoint (update settings)
 Channel validation (URL format, accessibility)
 Channel type detection
 Enable/disable toggles
 Last sync timestamp display
 Manual sync trigger endpoint

Task 4.7: Scheduled Scraper Orchestration
Epic: E5
Story Points: 3
Dependencies: Tasks 4.2-4.4, 4.6
User Story: As a system, I need to orchestrate scrapers so that all channels are checked regularly.
Acceptance Criteria:

 CloudWatch Events for daily scheduling
 Lambda to query active channels
 Invoke appropriate scraper per channel type
 Respect rate limits and quotas
 Error handling and retry logic
 Metrics for scraping success/failure


Sprint 5: Search Implementation & Frontend Foundation
Goal: Implement search functionality and basic frontend
Task 5.1: Bedrock Integration for Embeddings
Epic: E6
Story Points: 5
Dependencies: Task 1.2
User Story: As a system, I need to generate embeddings so that semantic search works.
Acceptance Criteria:

 Bedrock client configured
 Titan embeddings model integration (using Strands, not Agents)
 Batch embedding support
 Error handling for API limits
 Caching layer for repeated text
 Cost monitoring tags
 Embedding update strategy for modified content

Task 5.2: Search API Implementation
Epic: E6
Story Points: 8
Dependencies: Tasks 5.1, 2.3
User Story: As a user, I want to search for content so that I can find relevant resources.
Acceptance Criteria:

 GET /search endpoint
 Semantic search via pgvector
 Keyword search via full-text
 Hybrid ranking algorithm
 Filter by badges, type, date
 Respect visibility rules (including anonymous users)
 Pagination support
 Search analytics tracking

Task 5.3: Next.js Frontend Setup
Epic: E7
Story Points: 5
Dependencies: Task 1.5
User Story: As a developer, I want the frontend framework configured so that I can build the UI.
Acceptance Criteria:

 Next.js 14+ with App Router
 TypeScript configuration
 Tailwind CSS setup
 Environment variable handling
 API client generation from OpenAPI
 Error boundary setup
 Loading states
 Deployment script to S3/CloudFront

Task 5.4: Public Homepage
Epic: E7
Story Points: 5
Dependencies: Task 5.3
User Story: As a visitor, I want to see a homepage so that I understand the platform's purpose.
Acceptance Criteria:

 Hero section with value proposition
 Search bar (connected to search API)
 Features section
 Stats section (real data from API)
 Call-to-action for registration
 Responsive design
 SEO metadata

Task 5.5: Authentication UI
Epic: E7
Story Points: 8
Dependencies: Tasks 5.3, 2.5
User Story: As a user, I want to register and log in through the web interface.
Acceptance Criteria:

 Registration form with validation
 Login form
 Email verification flow
 Password reset flow
 Remember me functionality
 Social login prep (UI only)
 Error message display
 Success notifications

Task 5.6: Public Search Interface
Epic: E7
Story Points: 5
Dependencies: Tasks 5.3, 5.2
User Story: As an anonymous visitor, I want to search public content so that I can find resources without logging in.
Acceptance Criteria:

 Search bar on homepage
 Search results page
 Filter by content type
 Filter by AWS program badges
 Only show public content
 Pagination
 No login required
 Call-to-action to register for more features


Sprint 6: Frontend Features & User Experience
Goal: Build core user-facing features
Task 6.1: User Dashboard
Epic: E8
Story Points: 8
Dependencies: Tasks 5.3, 3.2
User Story: As a user, I want a dashboard so that I can see my content overview.
Acceptance Criteria:

 Content count by type
 Recent content list
 Quick actions (add content, manage channels)
 Visibility distribution chart
 Total views/engagement (if available)
 AWS program badges display
 Responsive grid layout
 Loading skeletons

Task 6.2: Content Management UI
Epic: E8
Story Points: 8
Dependencies: Tasks 6.1, 3.1-3.4
User Story: As a user, I want to manage my content through the web interface.
Acceptance Criteria:

 Content list with filters
 Add content form (all content types)
 Edit content modal
 Delete confirmation
 Bulk actions (change visibility)
 Content preview
 URL management
 Tag management

Task 6.3: Public Profile Pages
Epic: E8
Story Points: 5
Dependencies: Tasks 5.3, 3.2
User Story: As a visitor, I want to view user profiles so that I can see their contributions.
Acceptance Criteria:

 Route: /profile/[username]
 Display user info and badges
 AWS employee badge if applicable
 List public content
 Content filtering
 Social links (optional)
 Contact button (optional)
 404 for non-existent users
 SEO optimization

Task 6.4: Authenticated Search Interface
Epic: E8
Story Points: 8
Dependencies: Tasks 5.3, 5.2
User Story: As a logged-in user, I want enhanced search so that I can find community and AWS-only content.
Acceptance Criteria:

 Search bar with autocomplete
 Filter sidebar (badges, type, date, visibility)
 Search results cards with visibility indicators
 Pagination
 Sort options (relevance, date)
 Save search functionality
 No results state
 Search history (localStorage)
 Mobile-responsive filters

Task 6.5: Channel Management UI
Epic: E8
Story Points: 5
Dependencies: Tasks 6.1, 4.6
User Story: As a user, I want to manage channels through the web interface.
Acceptance Criteria:

 Add channel form with validation
 Channel list with status
 Enable/disable toggles
 Last sync display
 Manual sync trigger
 Delete confirmation
 Channel verification status
 Sync error display

Task 6.6: User Settings Page
Epic: E8
Story Points: 5
Dependencies: Tasks 6.1, 2.5
User Story: As a user, I want to manage my account settings so that I can control my preferences.
Acceptance Criteria:

 Profile editing (username, bio)
 Default visibility setting
 Email preferences
 Password change
 MFA setup
 Account deletion option
 Data export button
 Save confirmation

Task 6.7: Content Claiming Interface
Epic: E8
Story Points: 5
Dependencies: Tasks 6.1, 3.5
User Story: As a user, I want to browse and claim unclaimed content through the UI.
Acceptance Criteria:

 Browse unclaimed content page
 Search/filter unclaimed content
 Claim button with confirmation
 Bulk claim functionality
 Show original author
 Success/error notifications
 Claimed content moves to user's portfolio

Task 6.8: Content Merge Interface
Epic: E8
Story Points: 5
Dependencies: Tasks 6.2, 3.7
User Story: As a user, I want to merge duplicate content through the UI.
Acceptance Criteria:

 Duplicate detection indicators
 Select content to merge
 Preview merged result
 Choose primary content
 Confirm merge action
 Undo merge option (30 days)
 Merge history view

