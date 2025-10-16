AWS Community Content Hub – Sprint 6.5 Plan  
Goal: Stabilize Sprint 6 user experiences by delivering the missing platform capabilities, backend integrations, and build pipeline updates required for the UI to operate end-to-end.  

Task 6.5.1: Frontend API Client Hardening  
Epic: E8  
Story Points: 5  
Dependencies: Tasks 6.2, 6.4, 6.5  
User Story: As an authenticated user, I want every dashboard and management screen to talk to the backend reliably so that protected actions succeed without manual intervention.  
Acceptance Criteria:  
- Provide an authenticated API client factory that injects the bearer token and reuses it across all Sprint 6 screens (Content dashboard, Claiming, Merge, Search, Channels, Settings).  
- Serialize nested filter structures (arrays, objects, date ranges) into the query format expected by the `/search` API (e.g., `badges=hero,community_builder`, ISO dates for ranges).  
- Update all Sprint 6 pages to call the authenticated client (no direct `fetch` without auth headers).  
- Ensure unauthenticated flows (public profile, marketing pages) still work with the same client without leaking tokens.  
- Add regression tests covering token injection, serialization, and error propagation.  
- `npm run test --workspace=src/frontend -- --coverage` passes with no regressions, maintaining ≥90% coverage across statements/branches/functions/lines.  

Task 6.5.2: Dashboard Metrics & Engagement Fidelity  
Epic: E8  
Story Points: 3  
Dependencies: Tasks 6.1, 6.5.1  
User Story: As a contributor, I want the dashboard to reflect my true engagement numbers so I can trust the analytics.  
Acceptance Criteria:  
- Calculate “Total Engagement” by aggregating supported metrics (e.g., views + likes + stars + downloads) and surface the per-metric breakdown referenced in tests.  
- Ensure dashboards gracefully handle missing metrics, zero counts, and partial datasets.  
- Update tests to validate engagement math and empty-state rendering.  
- `npm run test --workspace=src/frontend` passes.  

Task 6.5.3: Authenticated Search Integration & Filters  
Epic: E8  
Story Points: 8  
Dependencies: Tasks 6.4, 6.5.1  
User Story: As a signed-in user, I want the enhanced search interface to retrieve accurate results when I filter by badges, visibility, content type, tags, and dates.  
Acceptance Criteria:  
- Map UI filters to backend query parameters exactly (matching `src/backend/openapi.yaml`).  
- Handle server responses that return either `results` or `content` arrays, including pagination metadata.  
- Maintain autocomplete, saved searches, and history using the normalized query payload.  
- Add integration-level tests that stub backend responses and assert filter persistence across pagination, sorting, and saved-search reloads.  
- `npm run test --workspace=src/frontend -- --coverage` passes.  

Task 6.5.4: Frontend Build & Deployment Readiness  
Epic: E1  
Story Points: 5  
Dependencies: Task 6.5.1  
User Story: As a devops engineer, I need the frontend build to succeed in CI/CD environments without manual environment hacking.  
Acceptance Criteria:  
- Replace the blanket `output: 'export'` config with a deployment strategy compatible with dynamic routes (`/profile/[username]`) or generate static params as required.  
- Load required env vars (`NEXT_PUBLIC_API_URL`, Cognito IDs) via typed configuration that fails fast in dev/tests and integrates with CI secrets.  
- All Sprint 6 pages render successfully under `npm run build` and `npm run start`.  
- `npm run build` succeeds from repo root, and `npm run synth --workspace=src/infrastructure` finishes without errors.  

Task 6.5.5: Backend Authentication Core Completion  
Epic: E6  
Story Points: 13  
Dependencies: Sprint 2 tasks (Auth foundation)  
User Story: As a platform engineer, I want token verification, registration, and refresh flows to function end-to-end so that Sprint 6 frontend calls are authorized securely.  
Acceptance Criteria:  
- Implement missing handlers referenced by tests (`auth/verify-email`, `auth/refresh`, `auth/register`, `auth/tokenVerifier`, `users/setup-mfa`, `users/update-profile`) with full Cognito integration and database persistence.  
- Provide environment-variable validation and sensible defaults for test suites (mocked Cognito, deterministic OTP secrets).  
- Ensure all associated Jest suites (`tests/backend/lambdas/auth/*.test.ts`, `tests/backend/lambdas/users/*.test.ts`) pass without modifying test expectations.  
- `npm run test --workspace=src/backend -- --runTestsByPath tests/backend/lambdas/auth/*.test.ts tests/backend/lambdas/users/*.test.ts` passes.  

Task 6.5.6: Channel & Content Service Backfill  
Epic: E7  
Story Points: 13  
Dependencies: Tasks 6.2, 6.5.5  
User Story: As a content manager, I need the API endpoints for channels and content to persist data so that the Sprint 6 UIs stop failing.  
Acceptance Criteria:  
- Implement channel CRUD lambdas (`create`, `update`, `list`, `delete`) to use pooled database connections, validate input, enforce duplicate checks, and return API error shapes defined in `docs/api-errors.md`.  
- Implement content `create` and `delete` handlers with ownership checks, visibility enforcement, and GDPR-compliant soft deletion where specified.  
- Provide a reusable database pool (e.g., via `src/backend/services/database`) and update repositories to use it instead of instantiating raw pools per lambda.  
- Ensure repository tests (`tests/backend/repositories/ChannelRepository.test.ts`, etc.) no longer error due to undefined pools.  
- `npm run test --workspace=src/backend -- channels content` (full backend suite recommended) passes.  

Task 6.5.7: Scraper & Queue Infrastructure Stabilization  
Epic: E4  
Story Points: 8  
Dependencies: Tasks 6.5.6, 4.6  
User Story: As a program manager, I need automated ingestion (RSS, YouTube, GitHub, content processor) to run without crashing so dashboards stay current.  
Acceptance Criteria:  
- Refactor scrapers (`blog-rss.ts`, `youtube.ts`, `github.ts`, `content-processor.ts`, `scrapers/orchestrator.ts`) to lazily validate environment variables, allowing unit tests to inject mocks without early exits.  
- Mock external services (SQS, RSS parser, GitHub API) in tests by dependency injection or test hooks rather than requiring real credentials.  
- Implement error handling that updates channel sync status using the repository and logs structured errors (per `docs/implementation-notes.md`).  
- Ensure SQS payloads match the `ContentProcessorMessage` interface.  
- `npm run test --workspace=src/backend -- scrapers` passes.  

Task 6.5.8: Badge Administration & Audit Logging  
Epic: E5  
Story Points: 5  
Dependencies: Task 6.5.6  
User Story: As an administrator, I need to grant and revoke badges, track AWS employee status, and audit actions so the public profile and dashboard badges stay accurate.  
Acceptance Criteria:  
- Implement admin badge lambda(s) to satisfy `tests/backend/lambdas/admin/badges.test.ts`, including authorization checks, validation, duplicate prevention, and audit logging.  
- Expose public badge listing endpoints consumed by profiles and dashboards.  
- Ensure audit log repository captures grant/revoke/status change events with metadata.  
- `npm run test --workspace=src/backend -- --runTestsByPath tests/backend/lambdas/admin/badges.test.ts` passes.  

Task 6.5.9: Database Migrations & Integration Layer  
Epic: E3  
Story Points: 13  
Dependencies: Tasks 6.5.6, 6.5.7, 6.5.8  
User Story: As a backend engineer, I need a fully functional database schema and migration workflow so backend endpoints persist data reliably.  
Acceptance Criteria:  
- Implement PostgreSQL schema (users, content, channels, badges, audit logs, etc.) consistent with `tools/openapi` and shared types.  
- Provide migration scripts compatible with local development and CI, including rollback support.  
- Ensure `tests/integration/database.test.ts` and repository tests pass using the test database container.  
- Document migration steps in `docs/` (link from README if necessary).  
- `npm run test --workspace=src/backend -- integration` passes on a clean checkout.  

Task 6.5.10: CI/CD Pipeline Recovery  
Epic: E1  
Story Points: 3  
Dependencies: Tasks 6.5.4, 6.5.5, 6.5.6, 6.5.9  
User Story: As the release manager, I need the GitHub Actions workflow validations to pass so we can ship confidently.  
Acceptance Criteria:  
- Update workflow configuration to use the restored build/test commands (frontend build, backend tests, lint, typecheck, audit).  
- Ensure mocked AWS services or scripts prevent calls to real infrastructure during CI runs.  
- Update pipeline tests (`tests/ci/pipeline.test.ts`) to reflect the corrected behavior while enforcing `core.setFailed` on build errors.  
- Full backend test suite (including CI tests) passes locally.  

Task 6.5.11: Documentation & Environment Parity  
Epic: E1  
Story Points: 2  
Dependencies: Tasks 6.5.4 – 6.5.10  
User Story: As a new contributor, I want accurate setup docs and environment templates so I can run the project without guesswork.  
Acceptance Criteria:  
- Update README / developer docs with required env vars for backend and frontend, including default values for local dev and test.  
- Provide `.env.example` or CDK parameter guidance that covers new services (queues, Cognito IDs, database).  
- Document commands required to verify Sprint 6 deliverables (`npm test`, `npm run test --workspace=src/frontend -- --coverage`, `npm run test --workspace=src/backend`, `npm run build`, `npm run synth --workspace=src/infrastructure`, `npm run typecheck`, `npm audit`).  
- Documentation reviewed and approved by at least one engineer (add checklist).  

Global Acceptance Criteria for Sprint 6.5:  
- `npm test` passes from repo root (running workspace tests).  
- `npm run test --workspace=src/frontend -- --coverage` maintains ≥90% across statements/branches/functions/lines.  
- `npm run test --workspace=src/backend` passes (including auth, channels, scrapers, admin, integration, CI suites).  
- `npm run typecheck` (root) succeeds.  
- `npm run build` and `npm run synth --workspace=src/infrastructure` complete successfully with required env vars documented.  
- `npm audit` reports zero vulnerabilities.  
- Database migrations run locally (documented command) and integration tests pass using the shared test container.  
- All Sprint 6 frontend features operate against the implemented backend without manual mocking, verified via automated tests aligned with user stories.  
