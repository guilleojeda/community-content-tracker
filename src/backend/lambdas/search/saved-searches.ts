import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse, parseRequestBody } from '../auth/utils';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Multi-route handler for saved searches
 *
 * Routes:
 * - POST /search/saved - Save a new search
 * - GET /search/saved - List user's saved searches
 * - GET /search/saved/:id - Get specific saved search
 * - PUT /search/saved/:id - Update saved search
 * - DELETE /search/saved/:id - Delete saved search
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const pathParameters = event.pathParameters || {};
  const searchId = pathParameters.id;
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  // Check authentication
  const authorizer: any = event.requestContext?.authorizer;
  const userId = authorizer?.userId;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'search:saved' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    if (!userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
    }

    const pool = await getDatabasePool();

    // Route based on method and path
    if (method === 'POST') {
      return withRateLimit(await saveSearch(pool, userId, event));
    } else if (method === 'GET' && !searchId) {
      return withRateLimit(await listSavedSearches(pool, userId));
    } else if (method === 'GET' && searchId) {
      return withRateLimit(await getSavedSearch(pool, userId, searchId));
    } else if (method === 'PUT' && searchId) {
      return withRateLimit(await updateSavedSearch(pool, userId, searchId, event));
    } else if (method === 'DELETE' && searchId) {
      return withRateLimit(await deleteSavedSearch(pool, userId, searchId));
    } else {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'Route not found'));
    }
  } catch (error: any) {
    console.error('Saved searches error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'Operation failed'),
      rateLimit
    );
  }
}

/**
 * POST /search/saved - Save a new search
 */
async function saveSearch(
  pool: any,
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { data, error } = parseRequestBody<{
    name: string;
    query: string;
    filters?: Record<string, any>;
    isPublic?: boolean;
  }>(event.body);

  if (error) {
    return error;
  }

  // Validate required fields
  if (!data?.name || !data?.query) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Name and query are required'
    );
  }

  // Validate name length
  if (data.name.length > 255) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Name must be 255 characters or less'
    );
  }

  // Validate query length
  if (data.query.length > 5000) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Query must be 5000 characters or less'
    );
  }

  try {
    const insertQuery = `
      INSERT INTO saved_searches (user_id, name, query, filters, is_public)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, name, query, filters, is_public, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [
      userId,
      data.name,
      data.query,
      JSON.stringify(data.filters || {}),
      data.isPublic || false,
    ]);

    const savedSearch = result.rows[0];

    return createSuccessResponse(201, {
      success: true,
      data: {
        id: savedSearch.id,
        userId: savedSearch.user_id,
        name: savedSearch.name,
        query: savedSearch.query,
        filters: savedSearch.filters,
        isPublic: savedSearch.is_public,
        createdAt: savedSearch.created_at,
        updatedAt: savedSearch.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Save search error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to save search');
  }
}

/**
 * GET /search/saved - List user's saved searches
 */
async function listSavedSearches(
  pool: any,
  userId: string
): Promise<APIGatewayProxyResult> {
  try {
    const selectQuery = `
      SELECT id, user_id, name, query, filters, is_public, created_at, updated_at
      FROM saved_searches
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;

    const result = await pool.query(selectQuery, [userId]);

    return createSuccessResponse(200, {
      success: true,
      data: {
        searches: result.rows.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          name: row.name,
          query: row.query,
          filters: row.filters,
          isPublic: row.is_public,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        count: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('List saved searches error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to list saved searches');
  }
}

/**
 * GET /search/saved/:id - Get specific saved search
 */
async function getSavedSearch(
  pool: any,
  userId: string,
  searchId: string
): Promise<APIGatewayProxyResult> {
  try {
    const selectQuery = `
      SELECT id, user_id, name, query, filters, is_public, created_at, updated_at
      FROM saved_searches
      WHERE id = $1
    `;

    const result = await pool.query(selectQuery, [searchId]);

    if (result.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Saved search not found');
    }

    const savedSearch = result.rows[0];

    // Check authorization - user must own the search or it must be public
    if (savedSearch.user_id !== userId && !savedSearch.is_public) {
      return createErrorResponse(
        403,
        'PERMISSION_DENIED',
        'You do not have permission to access this search'
      );
    }

    return createSuccessResponse(200, {
      success: true,
      data: {
        id: savedSearch.id,
        userId: savedSearch.user_id,
        name: savedSearch.name,
        query: savedSearch.query,
        filters: savedSearch.filters,
        isPublic: savedSearch.is_public,
        createdAt: savedSearch.created_at,
        updatedAt: savedSearch.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Get saved search error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to get saved search');
  }
}

/**
 * PUT /search/saved/:id - Update saved search
 */
async function updateSavedSearch(
  pool: any,
  userId: string,
  searchId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { data, error } = parseRequestBody<{
    name?: string;
    query?: string;
    filters?: Record<string, any>;
    isPublic?: boolean;
  }>(event.body);

  if (error) {
    return error;
  }

  // Validate at least one field is provided
  if (!data || (!data.name && !data.query && data.filters === undefined && data.isPublic === undefined)) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'At least one field must be provided for update'
    );
  }

  // Validate field lengths if provided
  if (data.name && data.name.length > 255) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Name must be 255 characters or less'
    );
  }

  if (data.query && data.query.length > 5000) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Query must be 5000 characters or less'
    );
  }

  try {
    // First check if search exists and user owns it
    const checkQuery = `
      SELECT user_id FROM saved_searches WHERE id = $1
    `;
    const checkResult = await pool.query(checkQuery, [searchId]);

    if (checkResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Saved search not found');
    }

    if (checkResult.rows[0].user_id !== userId) {
      return createErrorResponse(
        403,
        'PERMISSION_DENIED',
        'You do not have permission to update this search'
      );
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramCounter++}`);
      values.push(data.name);
    }

    if (data.query !== undefined) {
      updates.push(`query = $${paramCounter++}`);
      values.push(data.query);
    }

    if (data.filters !== undefined) {
      updates.push(`filters = $${paramCounter++}`);
      values.push(JSON.stringify(data.filters));
    }

    if (data.isPublic !== undefined) {
      updates.push(`is_public = $${paramCounter++}`);
      values.push(data.isPublic);
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    // Add search ID as final parameter
    values.push(searchId);

    const updateQuery = `
      UPDATE saved_searches
      SET ${updates.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING id, user_id, name, query, filters, is_public, created_at, updated_at
    `;

    const result = await pool.query(updateQuery, values);
    const savedSearch = result.rows[0];

    return createSuccessResponse(200, {
      success: true,
      data: {
        id: savedSearch.id,
        userId: savedSearch.user_id,
        name: savedSearch.name,
        query: savedSearch.query,
        filters: savedSearch.filters,
        isPublic: savedSearch.is_public,
        createdAt: savedSearch.created_at,
        updatedAt: savedSearch.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Update saved search error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to update saved search');
  }
}

/**
 * DELETE /search/saved/:id - Delete saved search
 */
async function deleteSavedSearch(
  pool: any,
  userId: string,
  searchId: string
): Promise<APIGatewayProxyResult> {
  try {
    // First check if search exists and user owns it
    const checkQuery = `
      SELECT user_id FROM saved_searches WHERE id = $1
    `;
    const checkResult = await pool.query(checkQuery, [searchId]);

    if (checkResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Saved search not found');
    }

    if (checkResult.rows[0].user_id !== userId) {
      return createErrorResponse(
        403,
        'PERMISSION_DENIED',
        'You do not have permission to delete this search'
      );
    }

    // Delete the search
    const deleteQuery = `
      DELETE FROM saved_searches WHERE id = $1
    `;
    await pool.query(deleteQuery, [searchId]);

    return createSuccessResponse(200, {
      success: true,
      message: 'Saved search deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete saved search error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to delete saved search');
  }
}
