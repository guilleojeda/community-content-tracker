Sprint 2: Authentication & Data Layer
Goal: Implement user authentication and core database functionalityTask 2.1: Cognito User Pool Setup
Epic: E2
Story Points: 3
Dependencies: Task 1.2User Story: As a user, I want to create an account so that I can track my content.Acceptance Criteria:

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
});Task 2.2: Database Schema Implementation
Epic: E3
Story Points: 5
Dependencies: Task 1.4User Story: As a developer, I want the database schema implemented so that I can store application data.Acceptance Criteria:

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

-- Continue with all tables...Task 2.3: Database Repository Layer
Epic: E3
Story Points: 8
Dependencies: Task 2.2User Story: As a developer, I want a repository pattern implementation so that I can interact with the database consistently.Acceptance Criteria:

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
});Task 2.4: Authentication Lambda Functions
Epic: E2
Story Points: 5
Dependencies: Tasks 2.1, 2.3User Story: As an API, I need to authenticate and authorize requests so that I can protect user data.Acceptance Criteria:

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
});Task 2.5: User Registration & Login APIs
Epic: E2
Story Points: 5
Dependencies: Tasks 2.1, 2.3, 2.4User Story: As a user, I want to register and log in so that I can access my account.Acceptance Criteria:

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
}Task 2.6: Admin Bootstrap Script
Epic: E2
Story Points: 2
Dependencies: Tasks 2.2, 2.3User Story: As a system operator, I need to create the first admin user so that I can manage the platform.Acceptance Criteria:

 CLI script to create first admin user
 Bypass email verification for first admin
 Set is_admin flag in database
 Add to admin group in Cognito
 Idempotent (safe to run multiple times)
 Environment-specific configuration
Script Example:
bashnpm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!