# Backup Verification Log

| Date | Snapshot ID | Verification Summary | Restored Cluster | Verified By |
|------|-------------|----------------------|------------------|-------------|
| 2025-01-12 | rds:community-content-hub-prod-2025-01-12-08-15 | Restored to `content-backup-verify-20250112`; ran `scripts/verify-backup.sql` (users=512, content=18,240, pgvector extension active). Exported GDPR tables matched production metrics. | us-east-1b (temporary) | J. Martinez |
| 2025-02-02 | rds:community-content-hub-prod-2025-02-02-07-45 | Snapshot restored and queried via bastion; audit log sample validated, consent table counts aligned with CloudWatch dashboards. Static asset manifest restored from S3 backup. | us-east-1d (temporary) | L. Chen |
