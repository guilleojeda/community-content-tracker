# Backup Verification Procedure

## Scope
This guide validates automated backups for the Aurora PostgreSQL cluster and S3 static assets before every production deployment.

## Database backups
1. **Identify snapshot:**
   - Open RDS console -> `community-content-tracker-<env>` cluster.
   - Locate the latest automated snapshot (`rds:AutomatedSnapshot`).
2. **Restore to staging clone:**
   - Restore the snapshot to a temporary cluster named `content-backup-verify-<date>` with minimal ACUs.
3. **Run verification script:**
   - Use the RDS Query Editor or RDS Data API to execute the statements in `scripts/verify-backup.sql`.
   - The script checks core row counts, pgvector/pg_trgm extensions, recent audit log activity, and export metadata recorded in `analytics_events`.
   - Compare the returned counts with production dashboards (Grafana -> GDPR Compliance) and investigate deltas >1%.
4. **Tear down clone:**
   - Delete the temporary cluster once verification succeeds (within 24 hours).
5. **Log evidence:**
   - Record snapshot ID, verification timestamp, and SQL output in `docs/operations/backup-log.md`.

## Static site backups
1. Static assets are versioned in S3 with object lock (7 day retention).
2. Run `aws s3 cp s3://community-content-frontend-backup/latest-manifest.json ./backups/<date>-manifest.json`.
3. Restore sample file (`/dashboard/index.html`) to temporary bucket and load in browser.
4. Document result in backup log.

## Frequency
- Perform full verification weekly (Fridays) and prior to major releases.
- Emergency verification required after high-severity incidents or failed synthetic checks.
