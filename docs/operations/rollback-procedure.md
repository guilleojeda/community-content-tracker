# Rollback Procedure

## Preconditions
- CloudFormation stacks succeed with `--no-rollback` disabled.
- Previous deployment artefacts stored in CodePipeline S3 bucket `community-content-artifacts`.

## Application rollback
1. **Identify target release:** Determine the last known good Git tag (from release notes or incident report).
2. **Backend:**
   - `git checkout <tag>`
   - `npm run build --workspace=src/backend`
   - Deploy via `cdk deploy CommunityContentHub-ApplicationApi-<EnvCapitalized> --require-approval never --hotswap`.
3. **Frontend:**
   - `npm run build:frontend --workspace=src/infrastructure`
   - `cdk deploy CommunityContentHub-StaticSite-<EnvCapitalized> --context environment=<env> --require-approval never --hotswap`
   - Confirm the deployment bucket reflects the expected static assets before continuing.
4. **Verify:**
   - Run synthetic monitor manually (`aws lambda invoke --function-name community-content-tracker-<env>-synthetic out.json`).
   - Check CloudWatch dashboard for error rate returning to normal.

## Database migrations rollback
1. Locate the migration ID (e.g., `011_update_gdpr_export`).
2. Run `npm run migrate:down --workspace=src/backend -- --to <id-1>`.
3. Confirm schema version with `SELECT id FROM schema_migrations ORDER BY executed_at DESC LIMIT 5;`.
4. Re-run smoke tests (`npm run test --workspace=src/backend -- content/gdpr`).

## Infrastructure rollback (blue/green)
1. Deploy previous stack version to the standby environment (`--context environment=blue` or `green`).
2. Update Route53 weights by redeploying the routing stack with new values:
   - `BLUE_GREEN_WEIGHT_BLUE=<value>`
   - `BLUE_GREEN_WEIGHT_GREEN=<value>`
   - `cdk deploy CommunityContentHub-BlueGreenRouting-Prod --context environment=prod`
3. Monitor synthetic checks and error-rate alarms for 15 minutes before shifting to 100%.

## Post-rollback actions
- Annotate CloudWatch dashboards with rollback timestamp.
- Notify stakeholders in the #launch channel.
- File follow-up ticket to investigate root cause and update tests.
