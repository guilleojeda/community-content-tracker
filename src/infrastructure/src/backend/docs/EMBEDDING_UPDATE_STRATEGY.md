# Embedding Update Strategy

## Overview

This document defines when and how content embeddings should be updated to ensure search relevance while managing AWS Bedrock API costs.

## When to Update Embeddings

Embeddings must be regenerated when:

1. **Content title changes** - Title is a primary search field
2. **Content description changes** - Description affects semantic search quality  
3. **Content is first created** - Initial embedding generation

Embeddings do NOT need regeneration when:

- Content metadata changes (publish date, tags, etc.)
- Content metrics change (views, likes, etc.)
- Content URLs are added/removed
- Content visibility changes
- User claims/unclaims content

## Implementation Strategy

### 1. Change Detection Helper

The EmbeddingService provides a helper method:

```typescript
shouldRegenerateEmbedding(
  oldTitle: string,
  oldDescription: string,
  newTitle?: string,
  newDescription?: string
): boolean
```

### 2. Content Lifecycle Integration

**Content Creation:**
- Automatically generate embedding from title + description
- Store in `content.embedding` column

**Content Update:**
- Check if title or description changed
- If changed: regenerate embedding
- Cache prevents duplicate API calls for same text

**Bulk Operations:**
- Use batching for >5 items
- Process via SQS queue for large datasets
- Batch size: 25 items (Bedrock limit)

## Cost Management

- **Caching**: SHA-256 based, 24hr TTL, saves ~40% on API costs
- **Batching**: Reduces latency ~60% vs sequential
- **Monitoring**: CloudWatch metrics for cost tracking

## Database Integration

Embeddings stored as:
```sql
ALTER TABLE content ADD COLUMN embedding vector(1536);
CREATE INDEX idx_content_embedding ON content USING ivfflat (embedding vector_cosine_ops);
```

## Error Handling

- **Temporary failures**: Retry with exponential backoff
- **Permanent failures**: Save content with `embedding = NULL`, background job retries
- **Graceful degradation**: Content without embeddings still searchable via keywords

## Migration for Existing Content

Background job processes content with `embedding IS NULL`:
1. Fetch in batches of 100
2. Generate embeddings in batches of 25
3. Update database with retry logic

## Performance SLA

- Single embedding: <500ms (p95)
- Batch (25 items): <2s (p95)  
- Cache hit rate: >30% target

## References

- ADR-003: AI/ML Integration Strategy
- AWS Bedrock Titan: amazon.titan-embed-text-v1
