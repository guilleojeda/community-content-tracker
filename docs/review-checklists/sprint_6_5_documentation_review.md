# Sprint 6.5 Documentation Review Checklist

This checklist records the documentation review required by Sprint 6.5 acceptance criteria.

## Environment Reference
- [x] Backend environment variables (including Cognito, queues, database, Bedrock) documented in `.env.example` and `README.md`.
- [x] Frontend environment variables (typed config, build defaults) documented in `README.md` and `docs/setup/local-development.md`.
- [x] Infrastructure secrets and CDK parameter guidance linked from `docs/deployment-instructions.md`.

## Verification Commands
- [x] `npm test`
- [x] `npm run test --workspace=src/frontend -- --coverage`
- [x] `npm run test --workspace=src/backend`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run synth --workspace=src/infrastructure`
- [x] `npm audit`
- [x] `npm run db:migrate --workspace=src/backend`

## Additional Notes
- [x] Local development guide updated with migration workflow and troubleshooting (`docs/setup/database-migrations.md`).
- [x] README points to this checklist for Sprint 6.5 deliverables.

## Approval
- Reviewed by: Codex Engineering Agent (2025-10-15)
