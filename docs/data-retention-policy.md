# Data Retention Policy

## Overview
The AWS Community Content Hub retains operational data for well-defined periods that balance
regulatory compliance with system performance. All retention windows are configurable through
environment variables and enforced by scheduled maintenance Lambdas.

## Retention Windows
- **Analytics events**: 24 months (730 days) kept for trend analysis, then removed by the
  `maintenance/data-retention` Lambda. Window is controlled with `ANALYTICS_RETENTION_DAYS`.
- **Audit log entries**: 7 years, retained to satisfy security and compliance requirements.
- **User profiles and content**: Stored until users request erasure. GDPR export/deletion endpoints
  allow users to retrieve or delete their data at any time.

## Enforcement
1. The `maintenance/data-retention` Lambda deletes analytics records older than the configured
   retention window and writes an audit log entry for traceability.
2. Account deletion triggers full removal of user data through the `delete_user_data` stored
   procedure and anonymises historical audit logs.
3. Infrastructure alarms should surface failures of the retention Lambda so operators can respond.

## Contact
Questions about retention configuration can be sent to the operations team at
operations@awscommunityhub.org.
