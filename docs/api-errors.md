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
json{
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

## 3. **Environment Variables Template**

Create `.env.template`:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=
CDK_DEFAULT_ACCOUNT=
CDK_DEFAULT_REGION=us-east-1

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/content_hub
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Authentication
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_REGION=us-east-1
JWT_SECRET=

# External APIs
YOUTUBE_API_KEY=
GITHUB_TOKEN=
BEDROCK_MODEL_ID=amazon.titan-embed-text-v1
BEDROCK_REGION=us-east-1

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_COGNITO_CLIENT_ID=
NEXT_PUBLIC_DOMAIN=localhost:3001

# Monitoring
CLOUDWATCH_NAMESPACE=ContentHub
ENVIRONMENT=development

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_BETA_FEATURES=false
MAINTENANCE_MODE=false

# Rate Limiting
RATE_LIMIT_ANONYMOUS=100
RATE_LIMIT_AUTHENTICATED=1000
RATE_LIMIT_WINDOW_MINUTES=1
