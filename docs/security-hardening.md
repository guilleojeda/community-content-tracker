# Sprint 8 Security Hardening Summary

This document captures the security measures introduced in Sprint 8 along with guidance for verification.

## Rate Limiting

- `src/backend/services/rateLimiter.ts` enforces per-identifier quotas for anonymous (`anon` prefix) and authenticated (`user` prefix) traffic.
- Redis (`REDIS_URL`) is used when available, falling back to the in-memory store in local/test environments.
- Tests: `tests/backend/services/RateLimiter.test.ts` covers both local store and Redis-backed behaviour.

## CORS Restrictions

- Shared helpers in `src/shared/cors.ts` normalise all response headers.
- Lambda utilities (`createSuccessResponse` / `createErrorResponse`) now use `buildCorsHeaders` to emit `Vary: Origin`, enforce the allowed origin list from `CORS_ORIGIN`, and honour `CORS_CREDENTIALS`.
- Manual handlers (search, stats, content CRUD, user GDPR flows) have been updated to reuse the helper with the appropriate HTTP methods.
- Tests: `tests/backend/services/Cors.test.ts`, `tests/backend/lambdas/search/search.test.ts`, and `tests/backend/lambdas/stats/platform-stats.test.ts` validate the emitted headers.

## Security Headers

- Security headers are enforced at the CDN edge via the CloudFront `ResponseHeadersPolicy` in `src/infrastructure/lib/stacks/static-site-stack.ts` (CSP, HSTS, X-Frame-Options, Referrer-Policy, etc.).
- `src/frontend/next.config.js` only configures bundling and asset limits; it is not the source of truth for security headers.

## SQL Injection / XSS Verification

1. Ensure the API is running locally (`npm run dev:backend`).
2. Execute targeted SQLi probes with sqlmap. Run `npm run security:sqlmap` which starts a parameterised query endpoint backed by `pg-mem`, executes `sqlmapproject/sqlmap` in Docker, and stores the raw report under `docs/security/sqlmap/`. Latest evidence: `docs/security/sqlmap/sqlmap-report-<timestamp>.log`.
   Automated regression coverage lives in `tests/backend/security/sql-injection-safety.test.ts`, which asserts that repository queries remain parameterised even when malicious payloads are supplied.
3. Validate XSS defences by attempting to submit payloads through content creation endpoints; responses should be escaped and server-side sanitisation should reject script tags. Unit coverage in `tests/backend/lambdas/users/update-profile.test.ts` enforces that profile fields containing `<script>` tags are rejected. Additional automated checks can be performed with tools such as OWASP ZAP's active scan against the local endpoint set.

## Dependency Vulnerability Scan

- Run `npm audit --audit-level=high` from the repository root as part of release readiness. Record and remediate any reported CVEs prior to deployment.

## API Key Rotation Strategy

- Secrets are sourced from AWS Secrets Manager and automatically rotated using the `api-key-rotation` Lambda. Provide the new key via SSM parameter `/${ENV}/api-keys/<service>/pending` (for example, `/prod/api-keys/youtube/pending`), then trigger `aws secretsmanager rotate-secret --secret-id <secret-name>`. The Lambda promotes the pending value to `AWSCURRENT`, clears the parameter, and updates application Lambdas via the rotation schedule (30 days in prod, 60 days elsewhere). Detailed runbook: `docs/operations/api-key-rotation.md`.

## On-Call Checklist Additions

- Monitor anonymous rate-limit metrics (CloudWatch `RateLimitExceeded` events) and 4xx spikes.
- Confirm CORS incident reports by inspecting the `Origin` field captured within structured logs before adjusting the allowlist.
