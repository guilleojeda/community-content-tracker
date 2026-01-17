import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, ScheduledEvent } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { normalizeUrl } from '../../utils/url-normalization';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { StandardUnit } from '@aws-sdk/client-cloudwatch';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

const awsRegion = process.env.AWS_REGION;
if (!awsRegion || awsRegion.trim().length === 0) {
  throw new Error('AWS_REGION must be set');
}

// Initialize CloudWatch client
const cloudwatchClient = new CloudWatchClient({ region: awsRegion });

/**
 * Helper function to publish CloudWatch metrics
 */
async function publishMetrics(duplicatesCount: number, duplicatesByType: Record<string, number>): Promise<void> {
  try {
    const metricData = [
      {
        MetricName: 'DuplicatesDetected',
        Value: duplicatesCount,
        Unit: 'Count' as StandardUnit,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'Function', Value: 'DuplicateDetection' }],
      },
      {
        MetricName: 'TitleDuplicates',
        Value: duplicatesByType.title || 0,
        Unit: 'Count' as StandardUnit,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'DetectionType', Value: 'Title' }],
      },
      {
        MetricName: 'UrlDuplicates',
        Value: duplicatesByType.url || 0,
        Unit: 'Count' as StandardUnit,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'DetectionType', Value: 'URL' }],
      },
      {
        MetricName: 'EmbeddingDuplicates',
        Value: duplicatesByType.embedding || 0,
        Unit: 'Count' as StandardUnit,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'DetectionType', Value: 'Embedding' }],
      },
    ];

    const command = new PutMetricDataCommand({
      Namespace: 'ContentHub',
      MetricData: metricData,
    });

    await cloudwatchClient.send(command);
  } catch (error) {
    console.error('Failed to publish CloudWatch metrics:', error);
    // Don't throw - metrics are non-critical
  }
}

/**
 * Helper function to persist duplicates to the database
 */
async function persistDuplicates(pool: any, userId: string, duplicates: any[]): Promise<void> {
  if (duplicates.length === 0) {
    return;
  }

  try {
    // Persist duplicate pairs to database
    const insertQuery = `
      INSERT INTO duplicate_pairs (
        content_id_1,
        content_id_2,
        similarity_type,
        similarity_score,
        detected_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (content_id_1, content_id_2) DO NOTHING
    `;

    const insertPromises = duplicates.map((dup) => {
      const [contentId1, contentId2] = [dup.id1, dup.id2].sort((a: string, b: string) =>
        a.localeCompare(b)
      );
      return pool.query(insertQuery, [
        contentId1,
        contentId2,
        dup.similarity_type,
        parseFloat(dup.similarity),
      ]);
    });

    await Promise.all(insertPromises);
    console.log(`Persisted ${duplicates.length} duplicate pairs for user ${userId}`);
  } catch (error) {
    console.error('Failed to persist duplicates:', error);
    // Don't throw - we still want to return the detection results
  }
}

/**
 * Helper function to detect duplicates for a specific user
 */
async function detectDuplicatesForUser(pool: any, userId: string): Promise<any[]> {
  const duplicates: any[] = [];

  // 1. Title similarity detection (>90% match)
  const titleSimilarityQuery = `
    SELECT
      c1.id as id1,
      c2.id as id2,
      c1.title as title1,
      c2.title as title2,
      similarity(c1.title, c2.title) as similarity,
      'title' as similarity_type
    FROM content c1
    JOIN content c2 ON c1.id < c2.id
      AND c1.user_id = c2.user_id
      AND c1.user_id = $1
      AND c1.deleted_at IS NULL
      AND c2.deleted_at IS NULL
    WHERE similarity(c1.title, c2.title) > 0.90
    ORDER BY similarity DESC
  `;

  try {
    const titleResult = await pool.query(titleSimilarityQuery, [userId]);
    duplicates.push(...titleResult.rows);
  } catch (error) {
    // pg_trgm extension might not be enabled, skip title similarity
    console.warn('Title similarity detection skipped (pg_trgm not available)');
  }

  // 2. URL matching detection with normalization
  // Fetch all content with URLs for normalization
  const urlFetchQuery = `
    SELECT
      c.id,
      c.title,
      cu.url
    FROM content c
    JOIN content_urls cu ON c.id = cu.content_id
    WHERE c.user_id = $1
      AND c.deleted_at IS NULL
  `;

  const urlFetchResult = await pool.query(urlFetchQuery, [userId]);

  // Normalize URLs and group by normalized URL
  const normalizedUrlMap = new Map<string, Array<{ id: string; title: string; originalUrl: string }>>();

  for (const row of urlFetchResult.rows) {
    const normalizedUrlValue = normalizeUrl(row.url);
    if (normalizedUrlValue) {
      if (!normalizedUrlMap.has(normalizedUrlValue)) {
        normalizedUrlMap.set(normalizedUrlValue, []);
      }
      normalizedUrlMap.get(normalizedUrlValue)!.push({
        id: row.id,
        title: row.title,
        originalUrl: row.url,
      });
    }
  }

  // Find duplicate groups (normalized URL with multiple content items)
  for (const [normalizedUrlValue, contents] of normalizedUrlMap.entries()) {
    if (contents.length > 1) {
      // Generate all pairs from this group
      for (let i = 0; i < contents.length; i++) {
        for (let j = i + 1; j < contents.length; j++) {
          duplicates.push({
            id1: contents[i].id,
            id2: contents[j].id,
            title1: contents[i].title,
            title2: contents[j].title,
            url: normalizedUrlValue,
            similarity: 1.0,
            similarity_type: 'url',
          });
        }
      }
    }
  }

  // 3. Embedding similarity detection (>0.95 cosine similarity)
  const embeddingSimilarityQuery = `
    SELECT
      c1.id as id1,
      c2.id as id2,
      c1.title as title1,
      c2.title as title2,
      1 - (c1.embedding <=> c2.embedding) as similarity,
      'embedding' as similarity_type
    FROM content c1
    JOIN content c2 ON c1.id < c2.id
      AND c1.user_id = c2.user_id
      AND c1.user_id = $1
      AND c1.deleted_at IS NULL
      AND c2.deleted_at IS NULL
      AND c1.embedding IS NOT NULL
      AND c2.embedding IS NOT NULL
    WHERE 1 - (c1.embedding <=> c2.embedding) > 0.95
    ORDER BY similarity DESC
  `;

  const embeddingResult = await pool.query(embeddingSimilarityQuery, [userId]);
  duplicates.push(...embeddingResult.rows);

  return duplicates;
}

/**
 * GET /content/duplicates
 * Detect duplicate content for the authenticated user
 * Uses multiple detection methods: title similarity, URL matching, and embedding similarity
 *
 * Also supports EventBridge scheduled invocations for batch processing
 */
export async function handler(
  event: APIGatewayProxyEvent | ScheduledEvent,
  context: Context
): Promise<APIGatewayProxyResult | void> {
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const pool = await getDatabasePool();

    // Check if this is a scheduled EventBridge invocation
    const isScheduledEvent = 'source' in event && event.source === 'aws.events';

    if (isScheduledEvent) {
      // Scheduled mode: Process all users
      console.log('Running scheduled duplicate detection for all users');

      // Get all active users
      const usersQuery = 'SELECT DISTINCT user_id FROM content WHERE deleted_at IS NULL';
      const usersResult = await pool.query(usersQuery);

      let totalDuplicates = 0;
      const duplicatesByType: Record<string, number> = { title: 0, url: 0, embedding: 0 };

      // Process each user
      for (const userRow of usersResult.rows) {
        const userId = userRow.user_id;
        console.log(`Processing duplicates for user: ${userId}`);

        try {
          const duplicates = await detectDuplicatesForUser(pool, userId);

          // Persist duplicates to database
          await persistDuplicates(pool, userId, duplicates);

          // Aggregate metrics
          totalDuplicates += duplicates.length;
          duplicates.forEach((dup) => {
            duplicatesByType[dup.similarity_type] = (duplicatesByType[dup.similarity_type] || 0) + 1;
          });
        } catch (userError) {
          console.error(`Failed to process duplicates for user ${userId}:`, userError);
          // Continue processing other users
        }
      }

      // Publish CloudWatch metrics
      await publishMetrics(totalDuplicates, duplicatesByType);

      console.log(`Scheduled duplicate detection complete. Total duplicates: ${totalDuplicates}`);
      return; // No response needed for scheduled events
    } else {
      // API Gateway mode: Process single user
      const apiEvent = event as APIGatewayProxyEvent;
      rateLimit = await applyRateLimit(apiEvent, { resource: 'content:detect-duplicates' });
      const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
        attachRateLimitHeaders(response, rateLimit);

      if (rateLimit && !rateLimit.allowed) {
        return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
      }

      const authorizer: any = apiEvent.requestContext?.authorizer;
      if (!authorizer || !authorizer.userId) {
        return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
      }

      const userId = authorizer.userId;
      console.log(`Running duplicate detection for user: ${userId}`);

      // Detect duplicates for the user
      const duplicates = await detectDuplicatesForUser(pool, userId);

      // Persist duplicates to database
      await persistDuplicates(pool, userId, duplicates);

      // Calculate metrics by type
      const duplicatesByType: Record<string, number> = { title: 0, url: 0, embedding: 0 };
      duplicates.forEach((dup) => {
        duplicatesByType[dup.similarity_type] = (duplicatesByType[dup.similarity_type] || 0) + 1;
      });

      // Publish CloudWatch metrics
      await publishMetrics(duplicates.length, duplicatesByType);

      // Format response
      const uniqueDuplicates = Array.from(
        new Map(
          duplicates.map((dup) => {
            const [firstId, secondId] = [dup.id1, dup.id2].sort((a: string, b: string) =>
              a.localeCompare(b)
            );

            return [
              `${firstId}-${secondId}`,
              {
                content1: { id: firstId, title: firstId === dup.id1 ? dup.title1 : dup.title2 },
                content2: { id: secondId, title: secondId === dup.id2 ? dup.title2 : dup.title1 },
                similarity: parseFloat(dup.similarity),
                similarityType: dup.similarity_type,
                url: dup.url || undefined,
              },
            ] as const;
          })
        ).values()
      );

      return withRateLimit(createSuccessResponse(200, {
        success: true,
        data: {
          duplicates: uniqueDuplicates,
          count: uniqueDuplicates.length,
        },
      }));
    }
  } catch (error: any) {
    console.error('Duplicate detection error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to detect duplicates'),
      rateLimit
    );
  }
}
