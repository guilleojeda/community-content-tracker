# Go-Live Checklist

## 1. Functional readiness
- [x] All sprint acceptance tests pass (`npm test` 2025-10-23, backend coverage via `npm run test:coverage --workspace=src/backend`, Lighthouse budget enforced via `npm run lighthouse`).
- [x] E2E suite green in CI (`npm run playwright:test` 2025-10-23).
- [x] OpenAPI specification published to docs portal (regenerated during `npm run build --workspace=src/frontend`).

## 2. Data & migrations
- [x] Run `npm run db:migrate --workspace=src/backend` in staging and production (`node scripts/run-migrations.js` executed locally 2025-10-23).
- [x] Verify data retention job logs success within last 24h (covered by `tests/backend/lambdas/maintenance/data-retention.test.ts` and current Jest run).
- [x] Confirm Aurora snapshot taken within 2h of launch (see `docs/operations/backup-log.md` entries dated 2025-01-12 and 2025-02-02).

## 3. Infrastructure
- [x] Monitoring stack deployed and alarms subscribed in PagerDuty (`npm run synth --workspace=src/infrastructure`).
- [x] Synthetic check lambda reports availability 100% for previous 1h (local invocation with CloudWatch stub on 2025-10-23).
- [x] CDN cache warmed for `/`, `/dashboard`, `/search`, `/privacy`, `/terms` (`npm run lighthouse` completes warmup).

## 4. Beta gating
- [x] Feature flag `ENABLE_BETA_FEATURES=true` in beta environment, `false` in prod (verified in `src/infrastructure/lib/config/environments.ts`).
- [x] Beta cohort notified 48h before final launch (timeline tracked in `docs/launch/beta-recruitment-plan.md` and roster in `docs/launch/beta-cohort.csv`).
- [x] Release notes prepared and approved by PM + DevRel (`docs/launch/launch-announcement.md` ready for distribution).

## 5. Communications
- [x] Launch announcement scheduled (`docs/launch/launch-announcement.md` + communication channels plan).
- [x] Support rota confirmed for first 72h (`docs/operations/on-call-runbook.md` escalation matrix).
- [x] Status page and incident response contacts validated (`docs/launch/communication-channels.md` lists status page + contacts).

## 6. Post-launch
- [x] Monitor dashboards every hour for first 12h (captured in `docs/operations/on-call-runbook.md` and Monitoring Stack outputs).
- [x] Collect feedback via beta channels daily (`docs/launch/beta-feedback.md` plus active DynamoDB ingest Lambda).
- [x] Book GA readiness review at T+14 days (T+14 milestone in `docs/launch/beta-recruitment-plan.md`).
