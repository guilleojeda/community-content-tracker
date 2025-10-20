import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { Visibility } from '@aws-community-hub/shared';

/**
 * GET /search/advanced
 * Advanced search with boolean operators, exact phrases, and wildcards
 *
 * Supported operators:
 * - AND: Both terms must be present
 * - OR: Either term can be present
 * - NOT: Term must not be present
 * - "phrase": Exact phrase matching
 * - wild*: Wildcard matching
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const params = event.queryStringParameters || {};
    const query = params.query || '';
    const format = params.format || 'json';
    const withinIds = params.withinIds?.split(',').map(id => id.trim()).filter(id => id) || [];

    if (!query) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Search query is required');
    }

    if (format !== 'json' && format !== 'csv') {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid format. Must be json or csv');
    }

    const pool = await getDatabasePool();

    // Check if user is authenticated
    const authorizer: any = event.requestContext?.authorizer;
    const userId = authorizer?.userId || authorizer?.claims?.sub || null;
    const awsEmployeeClaim =
      authorizer?.isAwsEmployee ??
      authorizer?.claims?.isAwsEmployee ??
      authorizer?.claims?.['custom:isAwsEmployee'];
    const isAwsEmployee =
      awsEmployeeClaim === true ||
      awsEmployeeClaim === 'true';

    // Determine visibility based on authentication
    const visibilityFilter = [Visibility.PUBLIC];
    if (userId) {
      visibilityFilter.push(Visibility.AWS_COMMUNITY);
    }
    if (isAwsEmployee) {
      visibilityFilter.push(Visibility.AWS_ONLY);
    }

    // Convert query to PostgreSQL tsquery format
    const tsQuery = convertToTsQuery(query);

    // Build search query - include URL for CSV export
    // Build parameter values array
    const values: any[] = [tsQuery, visibilityFilter, userId];
    let paramIndex = 3;

    let searchQuery = `
      SELECT
        c.id,
        c.user_id,
        c.title,
        c.description,
        c.content_type,
        c.visibility,
        c.publish_date,
        c.capture_date,
        c.metrics,
        c.tags,
        c.is_claimed,
        c.original_author,
        c.created_at,
        c.updated_at,
        url_data.url,
        u.username,
        u.email,
        u.is_aws_employee,
        ts_rank(
          to_tsvector('english', c.title || ' ' || COALESCE(c.description, '')),
          to_tsquery('english', $1)
        ) as rank
      FROM content c
      LEFT JOIN LATERAL (
        SELECT cu.url
        FROM content_urls cu
        WHERE cu.content_id = c.id AND cu.deleted_at IS NULL
        ORDER BY cu.created_at ASC
        LIMIT 1
      ) AS url_data ON TRUE
      LEFT JOIN users u ON u.id = c.user_id
      WHERE
        to_tsvector('english', c.title || ' ' || COALESCE(c.description, ''))
        @@ to_tsquery('english', $1)
        AND c.deleted_at IS NULL
        AND (
          c.visibility = ANY($2)
          OR ($3::uuid IS NOT NULL AND c.user_id = $3::uuid)
        )`;

    // Add withinIds filter if provided
    if (withinIds.length > 0) {
      paramIndex++;
      searchQuery += `
        AND c.id = ANY($${paramIndex})`;
      values.push(withinIds);
    }

    searchQuery += `
      ORDER BY rank DESC
      LIMIT 100
    `;

    const result = await pool.query(searchQuery, values);

    // Return CSV format if requested
    if (format === 'csv') {
      const csvContent = generateSearchCSV(result.rows);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="search_results.csv"`,
        },
        body: csvContent,
      };
    }

    // Default JSON response
    return createSuccessResponse(200, {
      success: true,
      data: {
        results: result.rows.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          title: row.title,
          description: row.description,
          contentType: row.content_type,
          visibility: row.visibility,
          publishDate: row.publish_date,
          captureDate: row.capture_date,
          metrics: row.metrics ?? {},
          tags: Array.isArray(row.tags) ? row.tags : [],
          isClaimed: row.is_claimed,
          originalAuthor: row.original_author,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          url: row.url,
          relevanceScore: row.rank !== null ? parseFloat(row.rank) : undefined,
          author: row.username
            ? {
                id: row.user_id,
                username: row.username,
                email: row.email,
                isAwsEmployee: row.is_aws_employee,
              }
            : undefined,
        })),
        count: result.rows.length,
        query: query,
      },
    });
  } catch (error: any) {
    console.error('Advanced search error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Search failed');
  }
}

/**
 * Convert user query to PostgreSQL tsquery format
 * Supports:
 * - AND operator (&)
 * - OR operator (|)
 * - NOT operator (!)
 * - Exact phrases (<->)
 * - Wildcards (:*)
 */
function convertToTsQuery(query: string): string {
  let tsQuery = query;

  // Handle quoted phrases (exact match)
  tsQuery = tsQuery.replace(/"([^"]+)"/g, (_match, phrase) => {
    const words = phrase.trim().split(/\s+/);
    return words.join(' <-> ');
  });

  // Handle boolean operators
  tsQuery = tsQuery.replace(/\bAND\b/gi, ' & ');
  tsQuery = tsQuery.replace(/\bOR\b/gi, ' | ');
  tsQuery = tsQuery.replace(/\bNOT\b/gi, ' !');

  // Handle wildcards
  tsQuery = tsQuery.replace(/(\w+)\*/g, '$1:*');

  // Clean up extra spaces and operators
  tsQuery = tsQuery
    .replace(/\s+/g, ' ')
    .replace(/\s*([&|!])\s*/g, '$1')
    .trim();

  // If no operators, default to AND between words
  if (!tsQuery.includes('&') && !tsQuery.includes('|') && !tsQuery.includes('!')) {
    tsQuery = tsQuery.split(/\s+/).join(' & ');
  }

  return tsQuery;
}

/**
 * Generate CSV content from search results
 */
function generateSearchCSV(rows: any[]): string {
  const headers = 'Title,Description,ContentType,PublishDate,URL';
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.title),
      escapeCsvField(row.description),
      row.content_type,
      row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '',
      escapeCsvField(row.url),
    ].join(',')
  );
  return [headers, ...lines].join('\n');
}

/**
 * Escape CSV field with proper handling of quotes, commas, and newlines
 */
function escapeCsvField(field: string): string {
  if (!field) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
