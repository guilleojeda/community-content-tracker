# On-Call Runbook

## 1. Alert intake
- Alerts are delivered to SNS topic `community-content-ops-<env>` and routed to PagerDuty/Slack.
- Every alert payload includes the alarm name and a CloudWatch console deep link.
- Acknowledge in Slack and PagerDuty within 5 minutes.

## 2. Immediate triage checklist
1. Open the **Operations** CloudWatch dashboard (`community-content-hub-<env>-operations`).
2. Identify which widget triggered the alarm (Search API errors, synthetic availability, etc.).
3. Check the synthetic monitor results for customer impact.
4. If multiple services degraded, prioritise user-facing APIs (search, stats) before background jobs.

## 3. Common alarms & actions
| Alarm | Trigger | Primary Actions |
|-------|---------|-----------------|
| `SearchErrorRateAlarm` | Error rate >1% for 5 min | Capture recent logs (`/aws/lambda/community-content-tracker-<env>-search`) and verify upstream dependencies (Bedrock, DB). Roll back latest deployment if correlated. |
| `SearchLatencyAlarm` | p99 > 1s | Inspect Dynamo/DB connections, enable query profiling, scale concurrency if needed. |
| `DatabaseConnectionsAlarm` | Connections > 70 | Confirm long-running queries, consider temporarily increasing Aurora capacity (ACU). |
| `ContentDlqAlarm` | Messages in DLQ | Inspect failed payloads in SQS DLQ, replay after remediation. |
| `SyntheticAvailabilityAlarm` | Canary failure | Check frontend availability, CloudFront health, and API Gateway statuses. |
| `DailyCostAlarm` | Estimated spend >$500 | Review AWS Cost Explorer for anomalous services, notify FinOps. |

## 4. Synthetic monitor failure
1. View latest Lambda logs for `community-content-tracker-<env>-synthetic` for HTTP status and latency.
2. Manually hit the configured URL to confirm outage.
3. If endpoint healthy but canary fails, redeploy the synthetic lambda.

## 5. Escalation matrix
- **Level 1:** On-call engineer (this runbook). Resolve within 30 minutes.
- **Level 2:** Platform lead (`platform@awscommunityhub.org`) for prolonged outages (>30 min) or database failover.
- **Level 3:** AWS TAM via Support ticket for regional service issues.

## 6. Post-incident tasks
- Record an incident summary in the Operations wiki within 24 hours.
- Raise follow-up Jira tasks for permanent fixes and retrospective.
- Update this runbook with any new mitigation steps learned during the incident.
