# Capacity Planning & Scaling Triggers

## Assumptions
- Target audience: 5,000 registered creators, 1,000 daily searchers.
- Workload mix: 70% search/read, 20% analytics, 10% content ingestion.
- Current infrastructure: Aurora Serverless v2 (2–4 ACUs), Lambda-based APIs behind API Gateway, CloudFront + S3 frontend.

## Scaling thresholds
| Component | Metric | Alarm/Trigger | Action |
|-----------|--------|---------------|--------|
| Search Lambda | Error rate > 1% (5 min) | `SearchErrorRateAlarm` | Increase provisioned concurrency to 20, enable reserved concurrency for hot shards |
| Search Lambda | p99 > 1s (5 min) | `SearchLatencyAlarm` | Enable code path with Redis cache + increase memory to 1024 MB |
| Aurora cluster | DatabaseConnections > 70 | `DatabaseConnectionsAlarm` | Scale ACUs to 8, evaluate connection pooling config |
| SQS DLQ | Messages >=1 | `ContentDlqAlarm` | Investigate failing ingestion jobs, replay after fix |
| Synthetic canary | Availability < 99% | `SyntheticAvailabilityAlarm` | Treat as Sev-1; roll back latest release if caused by deployment |

## Capacity targets (post-GA)
- Maintain <500 ms p95 latency for search under 1,000 concurrent users.
- Support bulk ingestion of 50k items in <10 minutes.
- Analytics export completes in <60 seconds for 12-month windows.

## Cost projections (monthly)
| Service | Baseline usage | Estimated cost |
|---------|----------------|----------------|
| Aurora Serverless v2 | 2 ACUs avg, 1 TB-month IO | ~$420 |
| Lambda (API + background) | 80M requests, 512 MB avg | ~$85 |
| API Gateway | 80M REST calls | ~$320 |
| CloudFront + S3 | 2 TB egress | ~$190 |
| SQS + SNS | 10M ops | ~$15 |
| CloudWatch (logs, metrics) | 200 GB logs + dashboards | ~$50 |
| Synthetic Canary Lambda | 12k invocations/month | <$5 |
| **Total** |  | **~$1,085** |

## Optimisation levers
- Enable Aurora AutoPause for beta environment to cut idle costs by ~35%.
- Cache hot search results in Redis (ElastiCache) if latency exceeds 250 ms at p95.
- Compress log ingestion using CloudWatch Embedded Metric Format to reduce log volume by ~40%.
- Use CloudFront tiered caching for static assets to lower egress by ~25%.

## Next steps
1. Run full staging load test against deployed API once blue/green rollout is available.
2. Implement AWS Application Auto Scaling policy for Lambda based on `ConcurrentExecutions` (scale between 10–100 reserved concurrency).
3. Review cost anomalies weekly using Cost Explorer (threshold: +15% week-over-week).
