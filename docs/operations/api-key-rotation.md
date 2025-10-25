# API Key Rotation Runbook

The Community Content Hub stores third-party API credentials (YouTube Data API keys and GitHub access tokens) in AWS Secrets Manager. The `api-key-rotation` Lambda keeps these secrets fresh by promoting staged values supplied through AWS Systems Manager Parameter Store.

Follow this procedure whenever you obtain a new key from the provider.

## 1. Stage the new key

1. Export the new credential from the provider's console.
2. Store it in Parameter Store under the pending path for the target environment:

   ```bash
   aws ssm put-parameter \
     --name "/<env>/api-keys/<service>/pending" \
     --type SecureString \
     --value "<NEW_KEY>" \
     --overwrite
   ```

   Examples:

   - `/prod/api-keys/youtube/pending`
   - `/staging/api-keys/github/pending`

   Parameters are encrypted at rest and cleared automatically when the rotation finishes.

## 2. Trigger rotation

Run the rotation command for the matching secret:

```bash
aws secretsmanager rotate-secret \
  --secret-id "<secret-name>"
```

Secret names follow the pattern `youtube-api-key-<env>` and `github-token-<env>`.

The rotation schedule also performs this step automatically every 30 days in production (60 days in lower environments). Manual invocation is useful for emergency rotations.

## 3. Verify success

1. Check the rotation Lambda logs (`/aws/lambda/<stack>-YouTubeApiKeyRotationFunction`) for `Rotation completed` entries.
2. Confirm the Parameter Store value has been deleted. If it remains, examine the logs for errors, remediate, and re-run `rotate-secret`.
3. Validate that dependent systems (ingestion Lambdas, scrapers) can authenticate with the new key.

## 4. Update change records

- Document the rotation in the operations journal, including the secret name, environment, and the operator who performed the change.
- Destroy local copies of the key after verification.

> **Tip:** if you need to cancel a pending rotation, delete the staged parameter and call `aws secretsmanager cancel-rotate-secret --secret-id <secret-name>`.
