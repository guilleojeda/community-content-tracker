Product Requirements Document (PRD)
AWS Community Content Hub
Executive Summary
The AWS Community Content Hub is an open-source platform that automates content tracking and reporting for AWS community contributors. It serves as a centralized repository for community-generated content, enabling contributors to manage their portfolio, AWS to track community contributions, and the broader community to discover experts and content.
Problem Statement
AWS community contributors currently rely on manual spreadsheets and fragmented tools to track their content across multiple platforms. This leads to:

Time-consuming manual data entry and maintenance
Incomplete tracking of contributions
Difficulty in discovering community experts for speaking engagements
Inefficient reporting to AWS programs (Community Builders, Heroes, Ambassadors)
Lack of visibility into the collective knowledge of the AWS community

Solution Overview
A unified platform that automatically ingests, categorizes, and tracks content from multiple sources, providing:

Automated content discovery and cataloging
Granular visibility controls
Semantic search capabilities
Program-specific reporting exports
Public profiles for contributors

Target Users
Primary Users

AWS Community Contributors (~5,000 registered users)

Community Builders, Heroes, Ambassadors, User Group Leaders
Create 10-200 pieces of content each
Need automated tracking and reporting


AWS Program Managers

Need visibility into community contributions
Require formatted reports for program evaluation


Content Seekers (~1,000 daily active users)

User group organizers seeking speakers
Community members looking for expertise
General public searching for AWS content



Core Features
1. User Management

Registration & Authentication: Email-based signup via Cognito
Profile Creation: Custom URL slugs (/profile/username)
Badge System: Manual validation and assignment of AWS program badges
Account Management: GDPR-compliant data export and deletion

2. Content Ingestion

Channel Sources: Automated scraping of blogs, YouTube channels, GitHub repos
Manual Entry: Individual content pieces, conference talks, podcasts
Duplicate Detection: Automatic identification and merging of duplicate content
Retroactive Claiming: Ability to claim existing content
Update Frequency: Daily for scraped content, real-time for RSS/webhooks

3. Content Management

Visibility Controls:

Default visibility setting per user
Per-content visibility override
Four levels: Private, AWS-only, AWS+Community, Public


Metadata Tracking:

Title, description, publish date, capture date
Views, likes, comments (when available)
Content type, custom tags
Multiple URLs for cross-posted content


Co-authorship: Manual addition of specific pieces to multiple authors

4. Search & Discovery

Semantic Search: Vector-based similarity search using pgvector
Filtering Options:

AWS program badges
Content type
Date ranges
Tags
Full-text search on title/description


Public Profiles: Showcase contributor portfolios

5. Analytics & Reporting

Personal Dashboard:

Topic distribution
Channel distribution
Content performance metrics


Export Functionality:

CSV export for AWS program reporting
Personal data export for GDPR compliance



Technical Requirements
Performance

Support 5,000 registered users
Handle 1,000 daily active searchers
Process ~50,000 content pieces
Daily content ingestion from multiple sources

Security & Compliance

GDPR compliance with data portability and right to erasure
Secure authentication via AWS Cognito
Granular permission model for content visibility
CloudWatch monitoring for system health

Scalability

Serverless architecture for automatic scaling
Efficient database queries with proper indexing
CDN-backed static content delivery

Success Metrics

User adoption: 500+ registered users in first 6 months
Content coverage: 10,000+ pieces tracked in first year
Search usage: 100+ daily searches
Program reporting: 50+ successful CSV exports monthly

Out of Scope

Content creation tools
Social features (comments, likes within platform)
Direct submission to AWS program tools
Real-time notifications
Public API for embedding
Content revision history tracking