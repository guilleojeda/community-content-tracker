# Critical Implementation Notes for AI Agents

## DO NOT Make These Common Mistakes:

### 1. Database Connections
- **NEVER** create a new database connection for each Lambda invocation
- **ALWAYS** use connection pooling with RDS Proxy
- **ALWAYS** close connections properly in Lambda handlers

### 2. Embedding Generation
- **NEVER** use Bedrock Agents - use Bedrock Runtime with InvokeModel
- **ALWAYS** batch embedding requests when processing multiple items
- **ALWAYS** cache embeddings to avoid regenerating for unchanged content

### 3. Authentication
- **NEVER** store JWT secrets in code
- **ALWAYS** verify tokens in the Lambda authorizer, not in individual functions
- **ALWAYS** include user context in the authorizer response

### 4. Search Implementation
- **NEVER** return all results - always paginate
- **ALWAYS** apply visibility filters BEFORE returning results
- **ALWAYS** use both semantic and keyword search for best results

### 5. Content Ingestion
- **NEVER** process content synchronously in API calls
- **ALWAYS** use SQS for async processing
- **ALWAYS** implement idempotency to handle duplicate messages

## Required Patterns:

### Repository Pattern Example:
```typescript
export class ContentRepository extends BaseRepository<Content> {
  async findByUserId(userId: string, visibility?: Visibility[]): Promise<Content[]> {
    const query = this.db
      .select()
      .from('content')
      .where('user_id', userId);
    
    if (visibility) {
      query.whereIn('visibility', visibility);
    }
    
    return query;
  }
}
Lambda Handler Pattern:
typescriptexport const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse and validate input
    const body = JSON.parse(event.body || '{}');
    const validation = validateInput(body);
    if (!validation.valid) {
      return errorResponse(400, 'VALIDATION_ERROR', validation.errors);
    }
    
    // 2. Get user context from authorizer
    const userId = event.requestContext.authorizer?.userId;
    
    // 3. Execute business logic
    const result = await businessLogic(body, userId);
    
    // 4. Return success response
    return successResponse(200, result);
    
  } catch (error) {
    // 5. Handle errors appropriately
    logger.error('Handler error', { error, event });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
};

## Performance Optimizations

- Critical API responses (e.g., platform statistics) are cached through `CacheService`, which uses Redis when `REDIS_URL` is provided and gracefully degrades to a no-op cache otherwise.
- Enabling `ENABLE_QUERY_PROFILING=true` records `EXPLAIN ANALYZE` plans for search queries to help diagnose slow database execution paths without changing application logic.
- Next.js enforces a 500KB asset/entrypoint budget and applies long-lived cache headers to static policy pages so CDN distributions keep them warm.

## CORS Configuration

- Build response headers with `createSuccessResponse` / `createErrorResponse` (or `buildCorsHeaders` for custom handlers) to ensure only approved origins are served.
- Configure allowed origins via the `CORS_ORIGIN` environment variable (comma-separated). This value is required; set it to `http://localhost:3000` for local development when needed.
- Override header lists with `CORS_ALLOW_HEADERS` and caching with `CORS_MAX_AGE`. Set `CORS_CREDENTIALS=true` to add `Access-Control-Allow-Credentials` automatically.
- For bespoke responses (e.g., manual `OPTIONS` handlers), import `buildCorsHeaders` from `src/shared/cors.ts` so infrastructure and Lambda placeholders stay in sync.
Testing Requirements:
Every Task MUST Include:

Unit tests for business logic (mock external dependencies)
Integration tests for database operations (use test containers)
API tests for endpoints (test full request/response cycle)
Error case tests (test all error conditions)

Test Data Consistency:
Always use these test users across all tests:

admin@test.com (admin user)
user1@test.com (community builder)
user2@test.com (hero)
user3@test.com (regular user)
anonymous (no auth)
