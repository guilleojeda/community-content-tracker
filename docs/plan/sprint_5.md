Sprint 5: Search Implementation & Frontend Foundation
Goal: Implement search functionality and basic frontendTask 5.1: Bedrock Integration for Embeddings
Epic: E6
Story Points: 5
Dependencies: Task 1.2User Story: As a system, I need to generate embeddings so that semantic search works.Acceptance Criteria:

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
Dependencies: Tasks 5.1, 2.3User Story: As a user, I want to search for content so that I can find relevant resources.Acceptance Criteria:

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
Dependencies: Task 1.5User Story: As a developer, I want the frontend framework configured so that I can build the UI.Acceptance Criteria:

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
Dependencies: Task 5.3User Story: As a visitor, I want to see a homepage so that I understand the platform's purpose.Acceptance Criteria:

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
Dependencies: Tasks 5.3, 2.5User Story: As a user, I want to register and log in through the web interface.Acceptance Criteria:

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
Dependencies: Tasks 5.3, 5.2User Story: As an anonymous visitor, I want to search public content so that I can find resources without logging in.Acceptance Criteria:

 Search bar on homepage
 Search results page
 Filter by content type
 Filter by AWS program badges
 Only show public content
 Pagination
 No login required
 Call-to-action to register for more features
