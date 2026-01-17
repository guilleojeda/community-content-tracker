# Administrator Guide – AWS Community Content Hub

## 1. Access control
- Administrators authenticate via the standard login and must have `isAdmin` flag set in Cognito.
- The Admin Console checks this flag server-side before granting access.

## 2. Dashboard overview
- **Platform Overview:** key metrics (users, AWS employees, content volume).
- **Badge Distribution:** monitor community badge allocation.
- **System Health:** realtime status from `/admin/system-health` endpoint.

## 3. User management
1. Open **Admin -> Users**.
2. Search by username/email, filter by badge.
3. View user details (content count, badges, recent activity).
4. Grant/Revoke badges individually or in bulk.
5. Export user list to CSV (auditable event stored in `export_history`).

## 4. Moderation workflow
- Flagged content automatically surfaces on **Admin -> Moderation**.
- Actions: Approve (clears flag), Remove (marks as removed), Delete (hard delete).
- Each action records an audit entry with actor, IP, and timestamp.

## 5. Audit log
- Accessible under **Admin -> Audit Log**.
- Filters: action type, actor, date range.
- Export via **Download JSON** for compliance audits.

## 6. Analytics exports
- **Program exports** generate CSVs for Community Builder, Hero, Ambassador, and User Group Leader programs.
- **Analytics CSV** exports engagement time series for custom reporting.
- All exports logged in `export_history` for GDPR traceability.

## 7. Operational tasks
- Review Operations dashboard daily (link provided in On-Call runbook).
- Respond to DLQ alarms by inspecting `content_processing_dlq` and reprocessing after fixes.
- Run backup verification script weekly (see `docs/operations/backup-verification.md`).

## 8. Security hygiene
- Enforce MFA for admin accounts via Cognito policies.
- Rotate admin credentials quarterly; record rotations in Security log.
- Review audit log weekly for anomalous actions.
