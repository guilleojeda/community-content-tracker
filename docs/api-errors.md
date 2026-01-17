# API Error Standards

All errors must follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {} // Optional additional context
  }
}
```

Error Codes:

AUTH_REQUIRED - 401: Authentication required
AUTH_INVALID - 401: Invalid token
PERMISSION_DENIED - 403: Insufficient permissions
NOT_FOUND - 404: Resource not found
VALIDATION_ERROR - 400: Input validation failed
DUPLICATE_RESOURCE - 409: Resource already exists
RATE_LIMITED - 429: Too many requests
INTERNAL_ERROR - 500: Unexpected server error

Validation Error Format:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "fields": {
        "email": "Invalid email format",
        "password": "Must be at least 12 characters"
      }
    }
  }
}
```

## 3. **Environment Variables Templates**

Use the provided templates instead of creating a new file from scratch:
- Backend/local: `.env.example`
- Backend/production: `.env.production.template`
- Frontend: `src/frontend/.env.template`

Backend template excerpt:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=
CDK_DEFAULT_ACCOUNT=
CDK_DEFAULT_REGION=us-east-1
ENVIRONMENT=development
DATABASE_NAME=community_content

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/content_hub
DATABASE_SECRET_ARN=
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=60000

# Authentication
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_REGION=us-east-1
TOKEN_VERIFICATION_TIMEOUT_MS=3000
MFA_TOTP_SEED=your-mfa-seed
AUTH_RATE_LIMIT_PER_MINUTE=1000
JWT_SECRET=

# CORS
CORS_ORIGIN=http://localhost:3000
CORS_ALLOW_HEADERS=Authorization,Content-Type
CORS_ALLOW_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_MAX_AGE=600
CORS_CREDENTIALS=true

# External APIs
YOUTUBE_API_KEY=
GITHUB_TOKEN=
BEDROCK_MODEL_ID=amazon.titan-embed-text-v1
BEDROCK_REGION=us-east-1

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_COGNITO_CLIENT_ID=
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=development
NEXT_PUBLIC_FEEDBACK_URL=https://awscommunityhub.org/beta-feedback
NEXT_PUBLIC_ENABLE_BETA_FEATURES=false

# Monitoring
CLOUDWATCH_NAMESPACE=ContentHub
SYNTHETIC_URL=http://localhost:3000

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_BETA_FEATURES=false
MAINTENANCE_MODE=false

# Rate Limiting
RATE_LIMIT_ANONYMOUS=100
RATE_LIMIT_AUTHENTICATED=1000
RATE_LIMIT_WINDOW_MINUTES=1
STATS_CACHE_TTL=60
ANALYTICS_RETENTION_DAYS=730
```
