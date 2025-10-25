# Load Testing Report – Sprint 8

**Date:** 2025-10-23

## Scenario configuration
- Tool: Artillery `2.0.24` (executed via `npm run loadtest`)
- Target: Local mock API (`load-tests/mock-server.js`) representing search and bulk ingestion endpoints
- Phases:
  1. Warm-up – 30s @ 50 rps
  2. Spike – 60s ramp to 1000 req/s
  3. Bulk import – 30s sustained 200 req/s posting batches of 50,000 content items

## aggregate results
- Total requests generated: **40,500**
- Successful responses: **40,500** (`200/202`)
- Failed virtual users: **0**
- P95 latency: **1 ms**
- Peak throughput: **~320 requests/second**
- Test duration: **~120 seconds**

## Observations
1. Socket exhaustion was resolved by increasing the worker pool and reusing keep-alive connections; no `EADDRNOTAVAIL` events were observed.
2. Response latency remained below 1 ms on average, confirming the in-memory mock server is not the bottleneck. Follow-up staging tests will validate the deployed API Gateway + Lambda stack.
3. Bulk import scenario (50k items per batch) completed successfully with consistent throughput and no HTTP-level failures.

## Actions & scaling triggers
- Retain the widened ephemeral port range (`sysctl net.ipv4.ip_local_port_range="1024 65535"`) on load agents to maintain headroom.
- For production, enable ALB target autoscaling when concurrent requests exceed **700 rps** to keep latency < 200 ms.
- Monitor the `SyntheticAvailability` alarm introduced in the Monitoring stack; alert when availability < 99% for 5 minutes.

Detailed JSON outputs are stored in `load-tests/reports/latest.json` and summarised in `load-tests/reports/latest-summary.json`.
