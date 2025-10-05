# Embedding Update Strategy

## Overview

This document outlines the strategy for updating and managing embeddings in the AWS Community Content Hub. Embeddings are vector representations of content generated using Amazon Bedrock's Titan Embeddings model (`amazon.titan-embed-text-v2:0`).

## Embedding Generation

### Model Specification
- **Model**: `amazon.titan-embed-text-v2:0`
- **Dimensions**: 1536-dimensional vectors
- **Service**: AWS Bedrock Runtime

### Input Text Preparation

Content is embedded using a structured template that combines multiple fields:

```typescript
const embeddingText = `
Title: ${content.title}
Description: ${content.description || ''}
Tags: ${content.tags.join(', ')}
Author: ${author || 'Unknown'}
Type: ${content.contentType}
`.trim();
```

This approach ensures:
- Semantic richness by combining multiple content attributes
- Consistent formatting for reproducible results
- Tag inclusion for topic-based similarity

## When to Update Embeddings

### Automatic Updates (Required)

Embeddings MUST be regenerated when:

1. **Title Changes** - Significant semantic impact
2. **Description Changes** - Core content modification
3. **Tag Changes** - Topic association updates
4. **Author Changes** - Attribution updates may affect relevance

### Implementation

The update logic is implemented in the Content update handler:

```typescript
// src/backend/lambdas/content/update.ts (lines 89-98)
const needsEmbeddingUpdate =
  updates.title !== undefined ||
  updates.description !== undefined ||
  updates.tags !== undefined ||
  updates.userId !== undefined;

if (needsEmbeddingUpdate) {
  // Regenerate embedding with new content
  const embedding = await embeddingService.generateEmbedding(embeddingText);
  updates.embedding = `[${embedding.join(',')}]`; // pgvector format
}
```

### No Updates Required

Embeddings are NOT regenerated for:
- Visibility changes (access control only)
- URL updates (external references)
- Metric updates (engagement data)
- Claim status changes
- Publish date updates

## Update Process Flow

```
┌─────────────────┐
│  Content Update │
└────────┬────────┘
         │
         ▼
┌─────────────────┐       No        ┌──────────────┐
│ Check if fields │────────────────►│ Skip Update  │
│ require update? │                 └──────────────┘
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Prepare Text    │
│ (Title + Desc + │
│  Tags + Author) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Call Bedrock    │
│ Titan Embedding │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Format as       │
│ pgvector array  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Update Database │
│ content_embeddi │
│ ngs table       │
└─────────────────┘
```

## Performance Considerations

### Caching Strategy

The `EmbeddingService` implements caching to avoid redundant API calls:

```typescript
// src/backend/services/EmbeddingService.ts (lines 93-98)
const cacheKey = this.getCacheKey(text);
const cached = this.cache.get(cacheKey);

if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
  return cached.embedding;
}
```

**Cache Configuration:**
- **TTL**: 1 hour (3,600,000 ms)
- **Implementation**: In-memory Map (Lambda container reuse)
- **Key**: SHA-256 hash of input text
- **Benefits**: Reduces cost and latency for frequently updated content

### Retry Strategy

Bedrock API calls implement exponential backoff:

```typescript
// src/backend/services/EmbeddingService.ts (lines 123-143)
let lastError: Error;
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    return await this.callBedrockApi(text);
  } catch (error) {
    lastError = error as Error;
    if (attempt < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, attempt);
      await this.sleep(delay);
    }
  }
}
```

**Retry Configuration:**
- **Max Retries**: 3
- **Base Delay**: 1000ms
- **Pattern**: Exponential (1s, 2s, 4s)
- **Use Case**: Transient Bedrock throttling

### Cost Optimization

**Best Practices:**
1. **Batch Processing** - Group content updates to minimize API calls
2. **Cache Reuse** - Leverage Lambda container reuse for frequently accessed content
3. **Conditional Updates** - Only regenerate when semantically relevant fields change
4. **Monitoring** - Track embedding generation via CloudWatch metrics

**Bedrock Pricing** (as of 2024):
- Titan Embed Text v2: ~$0.0001 per 1K tokens
- Average content: ~100-500 tokens
- Cost per embedding: ~$0.00001-0.00005

## Database Storage

### Schema

```sql
-- From src/backend/database/migrations/001_initial_schema.sql
CREATE TABLE content_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,  -- pgvector type
  model_version VARCHAR(50) NOT NULL DEFAULT 'amazon.titan-embed-text-v2:0',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(content_id)
);

-- Vector similarity index for fast searches
CREATE INDEX content_embeddings_vector_idx
  ON content_embeddings
  USING ivfflat (embedding vector_cosine_ops);
```

### Format Conversion

PostgreSQL pgvector requires array format:

```typescript
// Convert JavaScript array to pgvector format
const embedding = await embeddingService.generateEmbedding(text);
const pgvectorFormat = `[${embedding.join(',')}]`;

// Example: [0.123, -0.456, 0.789, ...]
```

## Monitoring

### CloudWatch Metrics

The `EmbeddingService` publishes metrics for tracking:

```typescript
// Namespace: CommunityContentHub/Embeddings
{
  MetricName: 'GenerationCount',
  Value: 1,
  Unit: 'Count',
  Dimensions: [{ Name: 'Operation', Value: 'GenerateEmbedding' }]
},
{
  MetricName: 'GenerationLatency',
  Value: latency,
  Unit: 'Milliseconds',
  Dimensions: [{ Name: 'Service', Value: 'Bedrock' }]
},
{
  MetricName: 'CacheHitRate',
  Value: cacheHit ? 1 : 0,
  Unit: 'Count',
  Dimensions: [{ Name: 'Service', Value: 'EmbeddingCache' }]
}
```

### Alerts

Recommended CloudWatch Alarms:
1. **High Latency**: `GenerationLatency > 3000ms` (p99)
2. **Low Cache Hit Rate**: `CacheHitRate < 50%` over 5 minutes
3. **API Errors**: `GenerationErrors > 10` in 1 minute
4. **Cost Tracking**: `GenerationCount` for budget monitoring

## Bulk Update Operations

For bulk content imports or migrations:

```typescript
// Example: Batch update with rate limiting
async function bulkUpdateEmbeddings(contentIds: string[]) {
  const BATCH_SIZE = 10;
  const DELAY_MS = 100; // Avoid Bedrock throttling

  for (let i = 0; i < contentIds.length; i += BATCH_SIZE) {
    const batch = contentIds.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (contentId) => {
      const content = await getContent(contentId);
      const embedding = await embeddingService.generateEmbedding(
        formatContentForEmbedding(content)
      );
      await updateContentEmbedding(contentId, embedding);
    }));

    if (i + BATCH_SIZE < contentIds.length) {
      await sleep(DELAY_MS);
    }
  }
}
```

## Model Version Management

### Current Version
- `amazon.titan-embed-text-v2:0` (1536 dimensions)

### Future Migrations

If Titan releases a new model version:

1. **Add model_version column tracking** (already implemented)
2. **Create migration script**:
   ```sql
   -- Identify content with old embeddings
   SELECT content_id
   FROM content_embeddings
   WHERE model_version != 'amazon.titan-embed-text-v3:0';

   -- Update schema if dimensions change
   ALTER TABLE content_embeddings
   ALTER COLUMN embedding TYPE vector(NEW_DIMENSIONS);
   ```
3. **Batch regenerate embeddings** using bulk update script
4. **Update service configuration** to use new model
5. **Verify search quality** with A/B testing

### Backward Compatibility

The `model_version` column allows:
- Tracking which model generated each embedding
- Gradual migration to new models
- Rollback capability if needed
- Analytics on model performance

## Search Integration

Embeddings power semantic search via cosine similarity:

```sql
-- From src/backend/services/SearchService.ts
SELECT
  c.*,
  1 - (ce.embedding <=> $embeddingParam::vector) AS semantic_score
FROM content c
JOIN content_embeddings ce ON c.id = ce.content_id
WHERE ce.embedding <=> $embeddingParam::vector < 0.3  -- Distance threshold
ORDER BY semantic_score DESC
LIMIT 10;
```

**Search Weights:**
- Semantic similarity: 70%
- Keyword match (ts_rank): 30%

## Security Considerations

1. **IAM Permissions** - Lambda execution role requires `bedrock:InvokeModel` for Titan
2. **Data Privacy** - Content text is sent to Bedrock; ensure compliance with data policies
3. **Rate Limiting** - Bedrock has service quotas; implement throttling for bulk operations
4. **Error Handling** - Never expose Bedrock errors to end users

## Testing

### Unit Tests

```typescript
describe('EmbeddingService', () => {
  it('should generate embeddings with correct dimensions', async () => {
    const embedding = await service.generateEmbedding('test content');
    expect(embedding).toHaveLength(1536);
  });

  it('should cache embeddings to avoid redundant calls', async () => {
    const text = 'test content';
    const first = await service.generateEmbedding(text);
    const second = await service.generateEmbedding(text);

    expect(mockBedrockSend).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('should retry on transient failures', async () => {
    mockBedrockSend
      .mockRejectedValueOnce(new Error('Throttling'))
      .mockResolvedValueOnce({ embedding: [...] });

    const embedding = await service.generateEmbedding('test');
    expect(mockBedrockSend).toHaveBeenCalledTimes(2);
  });
});
```

### Integration Tests

```typescript
it('should update embeddings when title changes', async () => {
  const content = await createTestContent();
  const originalEmbedding = await getEmbedding(content.id);

  await updateContent(content.id, { title: 'New Title' });

  const newEmbedding = await getEmbedding(content.id);
  expect(newEmbedding).not.toEqual(originalEmbedding);
});
```

## Future Enhancements

1. **Incremental Updates** - Delta embeddings for minor changes
2. **Multi-Model Ensemble** - Combine multiple embedding models
3. **Semantic Versioning** - Track embedding schema versions
4. **Real-Time Updates** - Stream-based embedding generation
5. **Cross-Lingual Support** - Multilingual embedding models

## References

- [AWS Bedrock Titan Embeddings Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [PostgreSQL Vector Search Best Practices](https://www.postgresql.org/docs/current/indexes-types.html)
- Sprint 5 Implementation: `docs/plan/sprint_5.md`
- Service Implementation: `src/backend/services/EmbeddingService.ts`
- Search Implementation: `src/backend/services/SearchService.ts`
