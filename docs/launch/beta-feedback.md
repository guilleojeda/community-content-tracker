# Beta Feedback Process

## Collection channels
1. **In-app form:** `Feedback` button (dashboard footer) opens embedded Typeform.
2. **Email:** `beta@awscommunityhub.org` monitored by product team.
3. **Weekly sync:** 30-minute video call to discuss blockers.

## Feedback form fields
- Participant ID (auto-populated)
- Feature area (content ingestion, search, analytics, GDPR, admin)
- Severity (P0–P4)
- Description (markdown supported)
- Reproduction steps / sample URLs
- Attachments (S3 signed URL upload)

## Workflow
1. Responses stored in DynamoDB table `beta_feedback` via Lambda (`feedback/ingest`).
2. SNS topic `beta-feedback` notifies product + engineering.
3. Integration with Jira: Lambda posts to `Feedback` project using REST API.
4. Weekly summary exported to Google Sheets via scheduled Lambda.

## Reporting
- KPI dashboard summarises number of issues by severity, feature area.
- Beta health score = 100 - (P0*10 + P1*5 + P2*2).
- Decision gate at T+14 days uses health score ≥80 and resolved critical issues.
