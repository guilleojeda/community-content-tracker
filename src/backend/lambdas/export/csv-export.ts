import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse } from '../auth/utils';
import { logExportEvent } from './utils';

const VALID_PROGRAM_TYPES = ['community_builder', 'hero', 'ambassador', 'user_group_leader'];

interface ExportRequest {
  programType: string;
  startDate?: string;
  endDate?: string;
}

/**
 * POST /export/csv
 * Export user's content in program-specific CSV format
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const authorizer: any = event.requestContext?.authorizer;
    if (!authorizer || !authorizer.userId) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const userId = authorizer.userId;
    const body: ExportRequest = JSON.parse(event.body || '{}');

    if (!body.programType || !VALID_PROGRAM_TYPES.includes(body.programType)) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        `Invalid program type. Must be one of: ${VALID_PROGRAM_TYPES.join(', ')}`
      );
    }

    const pool = await getDatabasePool();

    // Build query based on date range
    let query = `
      SELECT
        c.title,
        url_data.url,
        c.publish_date,
        c.content_type,
        c.metrics,
        c.tags
      FROM content c
      LEFT JOIN LATERAL (
        SELECT cu.url
        FROM content_urls cu
        WHERE cu.content_id = c.id AND cu.deleted_at IS NULL
        ORDER BY cu.created_at ASC
        LIMIT 1
      ) AS url_data ON TRUE
      WHERE c.user_id = $1 AND c.deleted_at IS NULL
    `;

    const values: any[] = [userId];

    if (body.startDate && body.endDate) {
      query += ' AND c.publish_date BETWEEN $2 AND $3';
      values.push(body.startDate, body.endDate);
    }

    query += ' ORDER BY c.publish_date DESC';

    const result = await pool.query(query, values);

    // Generate CSV based on program type
    let csvContent = '';

    switch (body.programType) {
      case 'community_builder':
        csvContent = generateCommunityBuilderCSV(result.rows);
        break;
      case 'hero':
        csvContent = generateHeroCSV(result.rows);
        break;
      case 'ambassador':
        csvContent = generateAmbassadorCSV(result.rows);
        break;
      case 'user_group_leader':
        csvContent = generateUserGroupLeaderCSV(result.rows);
        break;
    }

    // Log export event to analytics
    try {
      await logExportEvent({
        pool,
        userId,
        sessionId: (body as any)?.sessionId ?? null,
        ipAddress: event.requestContext?.identity?.sourceIp || null,
        userAgent: event.requestContext?.identity?.userAgent || null,
        metadata: {
          exportType: 'program',
          programType: body.programType,
          exportFormat: body.programType,
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          rowCount: result.rows.length,
        },
      });
    } catch (error) {
      // Log error but don't fail export
      console.error('Failed to log export event:', error);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${body.programType}_export.csv"`,
      },
      body: csvContent,
    };
  } catch (error: any) {
    console.error('CSV export error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to export CSV');
  }
}

function generateCommunityBuilderCSV(rows: any[]): string {
  const headers = 'Title,URL,PublishDate,ContentType';
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.title),
      escapeCsvField(row.url),
      row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '',
      row.content_type,
    ].join(',')
  );
  return [headers, ...lines].join('\n');
}

function generateHeroCSV(rows: any[]): string {
  const headers = 'Title,URL,PublishDate,ContentType,Views,Likes';
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.title),
      escapeCsvField(row.url),
      row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '',
      row.content_type,
      row.metrics?.views || 0,
      row.metrics?.likes || 0,
    ].join(',')
  );
  return [headers, ...lines].join('\n');
}

function generateAmbassadorCSV(rows: any[]): string {
  const headers = 'Title,URL,PublishDate,ContentType,Tags';
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.title),
      escapeCsvField(row.url),
      row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '',
      row.content_type,
      Array.isArray(row.tags) ? row.tags.join(';') : '',
    ].join(',')
  );
  return [headers, ...lines].join('\n');
}

function generateUserGroupLeaderCSV(rows: any[]): string {
  const headers = 'Title,URL,PublishDate,ContentType,EventDate';
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.title),
      escapeCsvField(row.url),
      row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '',
      row.content_type,
      row.metrics?.eventDate || '',
    ].join(',')
  );
  return [headers, ...lines].join('\n');
}

function escapeCsvField(field: string): string {
  if (!field) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
