Sprint 4: Content Ingestion Pipeline
Goal: Implement automated content scrapingTask 4.1: SQS Queue Infrastructure
Epic: E5
Story Points: 3
Dependencies: Task 1.2User Story: As a system, I need message queues so that I can process content asynchronously.Acceptance Criteria:

 Content processing queue created
 Dead letter queue configured
 Message retention set to 14 days
 Visibility timeout appropriate for processing
 CloudWatch alarms for DLQ messages
 Message attributes for routing
Task 4.2: Blog RSS Scraper
Epic: E5
Story Points: 8
Dependencies: Tasks 4.1, 2.3User Story: As a user, I want my blog automatically tracked so that I don't need to add each post manually.Acceptance Criteria:

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
Dependencies: Tasks 4.1, 2.3User Story: As a user, I want my YouTube videos tracked so that my video content is included.Acceptance Criteria:

 YouTube Data API v3 integration
 Extract video metadata
 Handle API quotas gracefully
 Support channel and playlist URLs
 Pagination for large channels
 API key stored in Secrets Manager
Task 4.4: GitHub Repository Scraper
Epic: E5
Story Points: 5
Dependencies: Tasks 4.1, 2.3User Story: As a user, I want my GitHub repos tracked so that my code contributions are visible.Acceptance Criteria:

 GitHub API integration
 Extract repo metadata and README
 Support for organizations
 Handle rate limiting
 Track stars, forks, language
 Filter by topic/language (optional)
Task 4.5: Content Processor Lambda
Epic: E5
Story Points: 8
Dependencies: Tasks 4.1-4.4, 5.1User Story: As a system, I need to process scraped content so that it's properly stored and indexed.Acceptance Criteria:

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
Dependencies: Task 2.3User Story: As a user, I want to manage my content channels so that automated tracking works correctly.Acceptance Criteria:

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
Dependencies: Tasks 4.2-4.4, 4.6User Story: As a system, I need to orchestrate scrapers so that all channels are checked regularly.Acceptance Criteria:

 CloudWatch Events for daily scheduling
 Lambda to query active channels
 Invoke appropriate scraper per channel type
 Respect rate limits and quotas
 Error handling and retry logic
 Metrics for scraping success/failure
