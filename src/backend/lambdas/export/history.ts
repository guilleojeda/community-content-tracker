import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool, closeDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';

const MAX_LIMIT = 100;

/**
 * GET /export/history
 * Returns export history for the authenticated user.
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const authorizer: any = event.requestContext?.authorizer;
    const userId = authorizer?.userId || authorizer?.claims?.sub;

    if (!userId) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const params = event.queryStringParameters || {};
    const limitParam = params.limit ? parseInt(params.limit, 10) : 25;
    const offsetParam = params.offset ? parseInt(params.offset, 10) : 0;
    const exportTypeFilter = params.exportType;

    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : 25;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    const pool = await getDatabasePool();

    const filterClauses: string[] = [];
    const queryValues: any[] = [userId];
    let paramIndex = 2;

    if (exportTypeFilter) {
      filterClauses.push(`metadata->>'exportType' = $${paramIndex}`);
      queryValues.push(exportTypeFilter);
      paramIndex += 1;
    }

    const filterSql = filterClauses.length > 0 ? ` AND ${filterClauses.join(' AND ')}` : '';

    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM analytics_events
       WHERE user_id = $1
         AND event_type = 'export'
         ${filterSql}`,
      queryValues
    );

    const total = parseInt(totalResult.rows[0]?.total ?? '0', 10);

    const historyResult = await pool.query(
      `SELECT id, metadata, created_at
       FROM analytics_events
       WHERE user_id = $1
         AND event_type = 'export'
         ${filterSql}
       ORDER BY created_at DESC
       LIMIT $${paramIndex}
       OFFSET $${paramIndex + 1}`,
      [...queryValues, limit, offset]
    );

    const history = historyResult.rows.map((row: any) => {
      const metadata = row.metadata ?? {};
      const exportType = typeof metadata.exportType === 'string' ? metadata.exportType : 'program';
      return {
        id: row.id,
        exportType,
        exportFormat: metadata.exportFormat ?? null,
        rowCount: Number.isFinite(metadata.rowCount) ? Number(metadata.rowCount) : null,
        createdAt: row.created_at,
        parameters: {
          programType: exportType === 'program' ? metadata.programType ?? metadata.exportFormat ?? null : null,
          startDate: metadata.startDate ?? null,
          endDate: metadata.endDate ?? null,
          groupBy: metadata.groupBy ?? null,
        },
      };
    });

    return createSuccessResponse(200, {
      success: true,
      data: {
        history,
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error('Export history retrieval error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch export history');
  }
}

export async function closePool(): Promise<void> {
  await closeDatabasePool();
}
