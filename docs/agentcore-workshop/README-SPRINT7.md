# AgentCore Workshop Notes – Sprint 7

This document captures the work performed during Sprint 7 to translate the Amazon Bedrock AgentCore workshop labs into our TypeScript/CDK stack. Use it as the canonical reference before editing any AgentCore code.

## Important: Bedrock Agents are forbidden in this repo

This project must not use the Bedrock Agents managed service or its APIs (for example the `bedrock-agent:*` IAM actions and `boto3.client('bedrock-agent')`). Some upstream workshop prerequisite templates reference those APIs for Knowledge Base examples (for example `prerequisite/knowledge-base-stack.yaml`). We keep those files only as workshop reference material; they are not deployed or referenced by our TypeScript/CDK infrastructure.

## Reference Labs

| Lab Folder | Purpose | TypeScript Mapping |
|------------|---------|--------------------|
| `lab-01-create-an-agent.ipynb` | Baseline Strands agent with DuckDuckGo tooling | Not implemented in this repo (out of scope for the roadmap app). |
| `lab-02-agentcore-memory.ipynb` | Memory strategies + hooks | `AgentCoreMemoryService` (under `src/backend/agents/roadmap/memory`) |
| `lab-03-agentcore-gateway.ipynb` | Gateway + MCP Lambda registration | `AgentCoreGatewayStack` + `agentcore-tools` Lambda |
| `lab-04-agentcore-runtime.ipynb` | Runtime packaging & observability | Implemented as CDK stack (comingled with runtime build system) |
| `lab-05-frontend.ipynb` | Frontend streaming client | React chat updates in Sprint 7 tasks (see frontend section) |

> **Parameter naming:** All SSM paths referenced by the notebooks are namespaced per environment using `/app/roadmap-intelligence/agentcore/<env>/...`. Replace `<env>` with `dev`, `prod`, etc., when following the workshop steps.
>
> **Strands SDK:** The workshop uses the Python Strands SDK (`strands-agents`). A TypeScript SDK (`@strands-agents/sdk`) is now available (public preview, requires Node.js 20+). This repo currently mirrors the patterns in first-party TypeScript scaffolds because our Lambdas/runtime are pinned to Node.js 18; consider adopting the SDK once the runtime moves to Node.js 20 and the package stabilizes.
>
> **Note:** `/roadmap/<env>/agentcore/tool-specs` stores a tool schema pointer (S3 URI + hash) for drift checks and troubleshooting. The schema itself is published to S3 by `AgentCoreGatewayStack` and referenced during gateway target registration (see `docs/infrastructure/secrets-manager.md`).

## Gateway MCP Tools

All tool schemas live in `src/shared/agentcore/toolSpecs.ts`. CDK publishes them to S3 via `AgentCoreGatewayStack` and the gateway custom resource registers the S3 URI with AgentCore so the Gateway target reads a single source of truth without hitting SSM/Lambda size limits.

### `transcripts___roadmap_context`
- **Description**: Returns sanitized transcript snippets filtered by NDA level, author, and timeframe.
- **Arguments**:
  - `ndaLevel` *(required)*: `company_wide` or `super_secret`.
  - `timeframeDays`: Integer (1–365), defaults to 30.
  - `limit`: Integer (1–25), defaults to 5.
  - `createdBy`: Optional user ID string.
- **Output**: `{ timeframeDays, items: [{ id, meetingDate, summary, attendees[], sourceType }] }`

### `announcements___roadmap_briefs`
- **Description**: Lists read-only announcement summaries with tags, service metadata, and citations.
- **Arguments**:
  - `ndaLevel` *(required)*.
  - `timeline`: `next30 | next60 | next90 | beyond | past`.
  - `serviceId`: AWS service UUID.
  - `includeOpportunities`: boolean.
  - `limit`: up to 50.
- **Output**: `{ filters, items: [{ id, description, service{...}, opportunity{...}, citations[] }] }`

### `announcements___opportunity_insights`
- **Description**: Summarizes opportunity-flagged announcements (private betas, launch partners, etc.).
- **Arguments**:
  - `ndaLevel` *(required)*.
  - `serviceId`: optional filter.
  - `confidence`: `rumored | in_discussion | confirmed`.
  - `limit`: up to 20.
- **Output**: `{ items: [{ id, service, confidence, opportunity{type,description}, citations[] }] }`

### `announcements___dedup_clusters`
- **Description**: Groups announcements that look like duplicates based on shared service + textual similarity. Mirrors the heuristics from `deduplicate-announcements`.
- **Arguments**:
  - `ndaLevel` *(required)*.
  - `serviceId`: optional focus.
  - `limit`: number of clusters (1–10, defaults to 3).
- **Output**: `{ items: [{ clusterId, serviceName, announcements:[{ id, description, similarity, citations[] }] }] }`

### Tool Invocation Example

```json
POST /agentcore/tools
{
  "toolName": "announcements___opportunity_insights",
  "arguments": {
    "ndaLevel": "company_wide",
    "limit": 3
  }
}
```

Sample response body:

```json
{
  "toolName": "announcements___opportunity_insights",
  "result": {
    "tool": "announcements___opportunity_insights",
    "items": [
      {
        "id": "ann-123",
        "service": {
          "id": "svc-1",
          "name": "Amazon Observability Hub",
          "shortName": "ObsHub"
        },
        "ndaLevel": "company_wide",
        "confidence": "confirmed",
        "opportunity": {
          "type": "Launch Partner",
          "description": "Looking for 3 lighthouse customers in NA/EU"
        },
        "citations": [
          { "transcriptId": "t-42", "title": "ObsHub status review" }
        ]
      }
    ]
  },
  "metadata": {
    "count": 1,
    "ndaLevel": "company_wide"
  }
}
```

## Gateway Registration Flow

1. `AgentCoreGatewayStack` builds the `agentcore-tools` Lambda with database access.
2. `AgentCoreGatewayStack` publishes the tool schema JSON to S3 and the custom resource Lambda (`agentcore-gateway` infra lambda) writes a pointer (S3 URI + hash) to `/roadmap/<env>/agentcore/tool-specs`.
3. CI/CD (or `cdk deploy RoadmapIntelligence-<env>-AgentCoreGateway`) replays the workshop script logic using the published S3 schema—no manual CLI invocations necessary.

## Troubleshooting Tips

- **Parameter Drift**: Run `aws ssm get-parameter --name /roadmap/<env>/agentcore/tool-specs` to get the schema pointer (S3 URI + hash) and confirm the hash matches the current `src/shared/agentcore/toolSpecs.ts` output.
- **Apple Silicon**: When replaying notebooks locally, export `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` before running Streamlit or the Strands CLI.
- **Dry-Run Gateway Calls**: Use the sandbox automation script (see `/scripts/agentcore-sandbox.ts`) with `--dry-run` to validate argument parsing without AWS credentials.

## Sandbox Automation

Use the TypeScript helper to provision or tear down practice environments without touching production:

```bash
# Preview the CLI calls we would make
ts-node scripts/agentcore-sandbox.ts bootstrap --dry-run --env dev

# Execute against a credentialed environment
ts-node scripts/agentcore-sandbox.ts bootstrap --no-dry-run --env dev
ts-node scripts/agentcore-sandbox.ts cleanup --no-dry-run --env dev
```

## Manual QA Playbook (Sprint 7)

Use the following checklist before signing off any AgentCore changes. The steps cover every persona that interacts with the new runtime and map directly to the acceptance criteria from E15-T1/T2.

### Prerequisites
- Run `npm run dev` to start the local UI (frontend dev server). The API and AgentCore runtime must be reachable via the `VITE_*` URLs below.
- In `.env.development`, set `VITE_API_URL`, `VITE_AGENTCORE_RUNTIME_URL`, and `VITE_AGENTCORE_SCOPES` to match the environment you are testing (for the local runtime container use `http://localhost:8080/invocations`).
- Create two Cognito users (`normal` and `super_secret`) via the Admin UI (`/admin/users`) or `POST /api/users` as a contributor (requires a deployed environment with Cognito).

### Normal User Flow
1. Login as a **normal** role account in the web app.
2. Navigate to `/chat` and open the **AgentCore Quick Chat** panel.
3. Ask “Show me launches for company-wide audiences”.
4. Verify:
   - NDA tier pill reads `company_wide`.
   - Runtime response contains only Company-Wide announcements.
   - `jest --runTestsByPath tests/unit/components/chat/AgentCorePanel.test.tsx` passes (ensures downgrade logic).

### Super Secret Flow (scope available)
1. Login as a **super_secret** user.
2. Ensure `window.__APP_CONFIG__.agentcoreScopes` includes `roadmap.superSecret`.
3. Submit “Any Observability betas next quarter?”.
4. Confirm `ndaLevel` sent to runtime is `super_secret` (browser devtools -> Network tab).
5. Acknowledge citations for Super Secret sources.

### Super Secret Flow (scope missing)
1. Logout and clear local storage.
2. Set `window.__APP_CONFIG__.agentcoreScopes = []` via browser console.
3. Login again as a super_secret user and load `/chat`.
4. Confirm yellow warning banner renders and runtime requests fall back to `company_wide`.

### Contributor Smoke Test
1. Login as a contributor.
2. Upload a transcript, wait for ingestion, then ask AgentCore for the transcript title.
3. Cross-check CloudWatch logs (`docs/RUNBOOK.md#trace-agentcore-conversations`) to ensure the runtime spans include the contributor’s conversation ID.
