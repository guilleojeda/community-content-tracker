import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse } from '../auth/utils';
import { logExportEvent } from '../export/utils';

interface ExportRequest {
  startDate?: string;
  endDate?: string;
  groupBy?: string;
}

/**
 * POST /analytics/export
 * Export user's analytics data as CSV
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    // Check authentication
    const authorizer: any = event.requestContext?.authorizer;
    if (!authorizer || !authorizer.userId) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const userId = authorizer.userId;
    const body: ExportRequest = JSON.parse(event.body || '{}');

    const pool = await getDatabasePool();

    // Build query to get analytics data
    let query = `
      SELECT
        c.publish_date as date,
        c.content_type,
        c.title,
        (c.metrics->>'views')::int as views,
        (c.metrics->>'likes')::int as likes,
        (c.metrics->>'comments')::int as comments
      FROM content c
      WHERE c.user_id = $1 AND c.deleted_at IS NULL
    `;

    const values: any[] = [userId];

    if (body.startDate && body.endDate) {
      query += ' AND c.publish_date BETWEEN $2 AND $3';
      values.push(body.startDate, body.endDate);
    }

    query += ' ORDER BY c.publish_date DESC';

    const result = await pool.query(query, values);

    // Generate CSV
    const csvContent = generateAnalyticsCSV(result.rows);

    try {
      await logExportEvent({
        pool,
        userId,
        sessionId: (body as any)?.sessionId ?? null,
        ipAddress: event.requestContext?.identity?.sourceIp || null,
        userAgent: event.requestContext?.identity?.userAgent || null,
        metadata: {
          exportType: 'analytics',
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          groupBy: body.groupBy ?? null,
          rowCount: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Failed to log analytics export event:', error);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="analytics_export.csv"',
      },
      body: csvContent,
    };
  } catch (error: any) {
    console.error('Analytics export error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to export analytics');
  }
}

function generateAnalyticsCSV(rows: any[]): string {
  const headers = 'Date,ContentType,Title,Views,Likes,Comments';
  const lines = rows.map((row) =>
    [
      row.date ? new Date(row.date).toISOString().split('T')[0] : '',
      row.content_type || '',
      escapeCsvField(row.title || ''),
      row.views || 0,
      row.likes || 0,
      row.comments || 0,
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
