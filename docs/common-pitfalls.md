# Common Pitfalls & Solutions

## 1. Lambda Cold Starts
**Problem**: First invocation is slow
**Solution**: 
- Use provisioned concurrency for critical paths
- Minimize package size
- Lazy load heavy dependencies

## 2. pgvector Index Performance
**Problem**: Slow similarity searches
**Solution**:
- Create index AFTER inserting initial data
- Use IVFFlat index with appropriate lists parameter
- Limit search to top-k results

## 3. CORS Issues
**Problem**: Frontend can't call API
**Solution**:
- Configure CORS in API Gateway
- Include credentials in fetch requests
- Set proper headers in Lambda responses

## 4. Token Expiration
**Problem**: Users get logged out unexpectedly
**Solution**:
- Implement token refresh mechanism
- Use refresh tokens properly
- Show warning before expiration

## 5. Database Migration Failures
**Problem**: Migrations fail in production
**Solution**:
- Always test migrations on copy of prod data
- Include rollback scripts
- Use transactions for DDL operations