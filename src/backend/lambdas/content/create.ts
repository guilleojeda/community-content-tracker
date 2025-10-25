import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool, PoolClient } from 'pg';
import { ContentType, Visibility, CreateContentRequest, ApiErrorResponse } from '@aws-community-hub/shared';
import { ContentRepository, ContentCreateData } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { getDatabasePool } from '../../services/database';
import { buildCorsHeaders } from '../../services/cors';

// CORS headers
const getCorsHeaders = (origin?: string | null) => ({
  ...buildCorsHeaders({ origin, methods: 'GET,POST,PUT,DELETE,OPTIONS', allowCredentials: true }),
  'Content-Type': 'application/json',
});

// Response builders
const successResponse = (statusCode: number, body: any, origin?: string | null): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    ...getCorsHeaders(origin),
  },
  body: JSON.stringify(body),
});

const errorResponse = (
  statusCode: number,
  code: string,
  message: string,
  details?: any,
  origin?: string | null
): APIGatewayProxyResult => {
  const response: ApiErrorResponse = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };

  return {
    statusCode,
    headers: {
      ...getCorsHeaders(origin),
    },
    body: JSON.stringify(response),
  };
};

// Validation helpers
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const isValidContentType = (type: string): type is ContentType => {
  return Object.values(ContentType).includes(type as ContentType);
};

const isValidVisibility = (visibility: string): visibility is Visibility => {
  return Object.values(Visibility).includes(visibility as Visibility);
};

const isValidDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};

// Validation function
interface ValidationResult {
  isValid: boolean;
  errors?: {
    fields: Record<string, string>;
  };
}

const validateInput = (body: any): ValidationResult => {
  const errors: Record<string, string> = {};

  // Validate title
  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    errors.title = 'Title is required and must be a non-empty string';
  } else if (body.title.length > 500) {
    errors.title = 'Title must not exceed 500 characters';
  }

  // Validate contentType
  if (!body.contentType) {
    errors.contentType = 'Content type is required';
  } else if (!isValidContentType(body.contentType)) {
    errors.contentType = `Invalid content type. Must be one of: ${Object.values(ContentType).join(', ')}`;
  }

  // Validate URLs
  if (!body.urls || !Array.isArray(body.urls)) {
    errors.urls = 'URLs must be an array';
  } else if (body.urls.length === 0) {
    errors.urls = 'At least one URL is required';
  } else {
    // Validate each URL
    const invalidUrls = body.urls.filter((url: any) => typeof url !== 'string' || !isValidUrl(url));
    if (invalidUrls.length > 0) {
      errors.urls = 'All URLs must be valid URL strings';
    }
  }

  // Validate visibility (optional)
  if (body.visibility !== undefined && !isValidVisibility(body.visibility)) {
    errors.visibility = `Invalid visibility. Must be one of: ${Object.values(Visibility).join(', ')}`;
  }

  // Validate tags (optional)
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      errors.tags = 'Tags must be an array';
    } else {
      const invalidTags = body.tags.filter((tag: any) => typeof tag !== 'string');
      if (invalidTags.length > 0) {
        errors.tags = 'All tags must be strings';
      }
    }
  }

  // Validate publishDate (optional)
  if (body.publishDate !== undefined && !isValidDate(body.publishDate)) {
    errors.publishDate = 'Invalid date format. Must be a valid ISO 8601 date string';
  }

  // Validate unclaimed content requirements
  if (body.isClaimed === false && (!body.originalAuthor || body.originalAuthor.trim().length === 0)) {
    errors.originalAuthor = 'Original author is required when content is unclaimed';
  }

  if (Object.keys(errors).length > 0) {
    return {
      isValid: false,
      errors: { fields: errors },
    };
  }

  return { isValid: true };
};

// Check if URLs already exist for this user
const checkUrlDuplication = async (
  pool: Pool | PoolClient,
  userId: string,
  urls: string[]
): Promise<{ isDuplicate: boolean; duplicateUrl?: string }> => {
  const query = `
    SELECT cu.url
    FROM content_urls cu
    INNER JOIN content c ON cu.content_id = c.id
    WHERE c.user_id = $1 AND cu.url = ANY($2::text[])
    LIMIT 1
  `;

  const result = await pool.query(query, [userId, urls]);

  if (result.rows.length > 0) {
    return {
      isDuplicate: true,
      duplicateUrl: result.rows[0].url,
    };
  }

  return { isDuplicate: false };
};

/**
 * Lambda handler for creating content
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const respondError = (status: number, code: string, message: string, details?: any) =>
    errorResponse(status, code, message, details, originHeader);
  const respondSuccess = (status: number, body: any) =>
    successResponse(status, body, originHeader);

  try {

    // Check authentication
    if (!event.requestContext?.authorizer?.userId) {
      return respondError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const userId = event.requestContext.authorizer.userId;

    // Parse request body
    let requestBody: CreateContentRequest;
    try {
      if (!event.body) {
        return respondError(400, 'VALIDATION_ERROR', 'Request body is required');
      }
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return respondError(400, 'VALIDATION_ERROR', 'Invalid JSON in request body');
    }

    // Validate input
    const validation = validateInput(requestBody);
    if (!validation.isValid) {
      return respondError(400, 'VALIDATION_ERROR', 'Validation failed', validation.errors);
    }

    // Get database connection
    const pool = await getDatabasePool();

    // Verify user exists and get default visibility
    const userRepo = new UserRepository(pool);
    let user;
    try {
      user = await userRepo.findById(userId);
    } catch (error) {
      // Handle invalid UUID format or other database errors
      return respondError(401, 'AUTH_INVALID', 'Invalid user');
    }

    if (!user) {
      return respondError(401, 'AUTH_INVALID', 'Invalid user');
    }

    // Trim whitespace from title and tags
    const title = requestBody.title.trim();
    const tags = requestBody.tags?.map(tag => tag.trim()).filter(tag => tag.length > 0) || [];

    // Deduplicate URLs within the request
    const uniqueUrls = [...new Set(requestBody.urls)];

    // Check for URL duplication across existing content
    const duplicationCheck = await checkUrlDuplication(pool, userId, uniqueUrls);
    if (duplicationCheck.isDuplicate) {
      return respondError(
        409,
        'DUPLICATE_RESOURCE',
        `URL already exists in your content: ${duplicationCheck.duplicateUrl}`
      );
    }

    // Prepare content data
    const contentData: ContentCreateData = {
      userId,
      title,
      description: requestBody.description,
      contentType: requestBody.contentType,
      visibility: requestBody.visibility || user.defaultVisibility,
      tags,
      urls: uniqueUrls,
      publishDate: requestBody.publishDate ? new Date(requestBody.publishDate) : undefined,
      isClaimed: requestBody.isClaimed !== undefined ? requestBody.isClaimed : true,
      originalAuthor: requestBody.originalAuthor,
    };

    // Create content using repository (with transaction)
    const contentRepo = new ContentRepository(pool);
    const createdContent = await contentRepo.createContent(contentData);

    // Return success response with created content
    return respondSuccess(201, createdContent);

  } catch (err) {
    console.error('Error creating content:', err);

    // Handle specific error types
    if (err instanceof Error) {
      // Log the full error for debugging
      console.error('Error stack:', err.stack);
    }

    return respondError(500, 'INTERNAL_ERROR', 'An unexpected error occurred while creating content');
  }
};
