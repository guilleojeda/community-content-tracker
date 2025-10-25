# Frequently Asked Questions

## Accounts
**Q:** Can I change my email address?
**A:** Yes. Update the email in **Settings → Profile**; Cognito sends a verification code to confirm the change.

**Q:** How do I enable MFA?
**A:** Visit **Settings → Security**, click **Enable MFA**, scan the QR code, and enter a TOTP from your authenticator app.

## Content ingestion
**Q:** Which content types are supported?
**A:** Blogs, YouTube, GitHub, conference talks, podcasts, whitepapers, workshops, tutorials, books, and custom social posts.

**Q:** Can I bulk import content?
**A:** Yes. Use **Dashboard → Content → Bulk Import** and provide a CSV containing title, URL, publish date, and tags.

## Search
**Q:** How is semantic search implemented?
**A:** We combine pgvector embeddings (Bedrock `amazon.titan-embed-text-v1`) with PostgreSQL full-text search, blended 70/30.

**Q:** Why do I see private content in results?
**A:** Authenticated users can see their own private content. Visibility filters strictly enforce `private`, `aws_only`, `aws_community`, and `public` levels.

## GDPR
**Q:** Where is my export file stored?
**A:** The export endpoint returns a downloadable JSON directly to the browser; no copies persist after download.

**Q:** How long does account deletion take?
**A:** Deletion is immediate for database records. Cognito user removal is attempted synchronously and retried if necessary.

## Administration
**Q:** How do I reinstate content removed by moderation?
**A:** Use **Admin → Moderation history** to locate the action and click **Undo Remove** (available for 30 days).

**Q:** Can I integrate with external analytics?
**A:** Yes. Use the Analytics CSV export or connect CloudWatch metrics to QuickSight.
