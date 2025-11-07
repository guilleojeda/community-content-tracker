import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Visibility } from '@aws-community-hub/shared';
import type { CorsOptions } from '../../services/cors';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { EmbeddingService } from '../../services/EmbeddingService';

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS = 50;

let embeddingService: EmbeddingService | null = null;

const getEmbeddingService = (): EmbeddingService => {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
};

interface ValidationResult {
  isValid: boolean;
  errors?: { fields: Record<string, string> };
}

const parseVisibility = (value: unknown): Visibility | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return Object.values(Visibility).includes(value as Visibility) ? (value as Visibility) : undefined;
};

const validateUpdateRequest = (body: any): ValidationResult => {
  const fieldErrors: Record<string, string> = {};

  if (body.version === undefined || typeof body.version !== 'number') {
    fieldErrors.version = 'Version is required for optimistic locking';
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      fieldErrors.title = 'Title must be a string';
    } else if (body.title.trim().length === 0) {
      fieldErrors.title = 'Title must not be empty';
    } else if (body.title.length > MAX_TITLE_LENGTH) {
      fieldErrors.title = `Title must not exceed ${MAX_TITLE_LENGTH} characters`;
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      fieldErrors.description = 'Description must be a string';
    } else if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      fieldErrors.description = `Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`;
    }
  }

  if (body.visibility !== undefined) {
    if (!parseVisibility(body.visibility)) {
      fieldErrors.visibility = `Invalid visibility. Must be one of: ${Object.values(Visibility).join(', ')}`;
    }
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      fieldErrors.tags = 'Tags must be an array';
    } else if (body.tags.length > MAX_TAGS) {
      fieldErrors.tags = `Tags must not exceed maximum of ${MAX_TAGS}`;
    } else if (body.tags.some((tag: unknown) => typeof tag !== 'string')) {
      fieldErrors.tags = 'All tags must be strings';
    }
  }

  if (body.publishDate !== undefined) {
    const date = new Date(body.publishDate);
    if (Number.isNaN(date.getTime())) {
      fieldErrors.publishDate = 'publishDate must be a valid ISO 8601 string';
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { isValid: false, errors: { fields: fieldErrors } };
  }

  return { isValid: true };
};

const normalizeTags = (tags: string[] | undefined): string[] | undefined => {
  if (!tags) {
    return undefined;
  }

  const sanitized = tags
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);

  const unique = Array.from(new Set(sanitized));
  return unique;
};

const normalizeUrls = (content: { id: string; urls: any }): Array<{ id: string; url: string }> => {
  const urls = Array.isArray(content.urls) ? content.urls : [];

  return urls
    .map((entry: any, index: number) => {
      if (!entry) {
        return null;
      }

      if (typeof entry === 'string') {
        return { id: `url-${content.id}-${index}`, url: entry };
      }

      if (typeof entry === 'object' && typeof entry.url === 'string') {
        return {
          id: entry.id ?? `url-${content.id}-${index}`,
          url: entry.url,
        };
      }

      return null;
    })
    .filter((entry): entry is { id: string; url: string } => Boolean(entry));
};

const getUserIdFromEvent = (event: APIGatewayProxyEvent): string | null => {
  const authorizer: any = event.requestContext?.authorizer;
  if (!authorizer) {
    return null;
  }

  return authorizer.userId ?? authorizer.claims?.sub ?? authorizer.claims?.username ?? null;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const corsOptions: CorsOptions = {
    origin: originHeader,
    methods: 'OPTIONS,PUT',
    allowCredentials: true,
  };

  const respondError = (
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => createErrorResponse(statusCode, code, message, details, corsOptions);

  const respondSuccess = (statusCode: number, body: Record<string, unknown>) =>
    createSuccessResponse(statusCode, body, corsOptions);

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const contentId = event.pathParameters?.id;
    if (!contentId) {
      return respondError(400, 'VALIDATION_ERROR', 'Content ID is required', {
        fields: { id: 'Content ID is required' },
      });
    }

    if (!event.body) {
      return respondError(400, 'VALIDATION_ERROR', 'Request body is required');
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      return respondError(400, 'VALIDATION_ERROR', 'Invalid JSON in request body');
    }

    const validation = validateUpdateRequest(parsedBody);
    if (!validation.isValid) {
      return respondError(400, 'VALIDATION_ERROR', 'Validation failed', validation.errors);
    }

    const pool = await getDatabasePool();
    const contentRepository = new ContentRepository(pool);
    const userRepository = new UserRepository(pool);

    const user = await userRepository.findById(userId);
    if (!user) {
      return respondError(401, 'AUTH_INVALID', 'Invalid user credentials');
    }

    const existingContent = await contentRepository.findById(contentId);
    if (!existingContent) {
      return respondError(404, 'NOT_FOUND', 'Content not found');
    }

    const isOwner = existingContent.userId === userId;
    const isAdmin = user.isAdmin === true;

    if (!isOwner && !isAdmin) {
      return respondError(403, 'PERMISSION_DENIED', 'You are not authorized to update this content');
    }

    const sanitizedTitle =
      parsedBody.title !== undefined ? (parsedBody.title as string).trim() : undefined;
    const sanitizedDescription =
      parsedBody.description !== undefined ? (parsedBody.description as string).trim() : undefined;
    const sanitizedVisibility = parseVisibility(parsedBody.visibility);
    const sanitizedTags = normalizeTags(parsedBody.tags);
    const sanitizedPublishDate =
      parsedBody.publishDate !== undefined ? new Date(parsedBody.publishDate) : undefined;

    const updatePayload: Record<string, unknown> = {};

    if (sanitizedTitle !== undefined) {
      updatePayload.title = sanitizedTitle;
    }
    if (sanitizedDescription !== undefined) {
      updatePayload.description = sanitizedDescription;
    }
    if (sanitizedVisibility !== undefined) {
      updatePayload.visibility = sanitizedVisibility;
    }
    if (sanitizedTags !== undefined) {
      updatePayload.tags = sanitizedTags;
    }
    if (sanitizedPublishDate !== undefined) {
      updatePayload.publishDate = sanitizedPublishDate;
    }

    if (Object.keys(updatePayload).length === 0) {
      return respondError(400, 'VALIDATION_ERROR', 'No updateable fields were provided');
    }

    const expectedVersion: number = parsedBody.version;

    let embedding: number[] | undefined;
    const shouldRefreshEmbedding =
      updatePayload.title !== undefined || updatePayload.description !== undefined;

    if (shouldRefreshEmbedding) {
      const embeddingText = `${(updatePayload.title as string | undefined) ?? existingContent.title} ${
        (updatePayload.description as string | undefined) ?? existingContent.description ?? ''
      }`.trim();

      if (embeddingText.length > 0) {
        try {
          const embedService = getEmbeddingService();
          const generated = await embedService.generateContentEmbedding(
            (updatePayload.title as string | undefined) ?? existingContent.title,
            (updatePayload.description as string | undefined) ?? existingContent.description
          );
          if (generated && generated.length > 0) {
            embedding = generated;
          }
        } catch (error) {
          console.error('Failed to generate embedding for content update', {
            contentId,
            error,
          });
        }
      }
    }

    const updatedContent = await contentRepository.updateWithEmbedding(
      contentId,
      {
        ...(updatePayload as any),
        ...(embedding ? { embedding } : {}),
      },
      { expectedVersion }
    );

    if (!updatedContent) {
      return respondError(409, 'DUPLICATE_RESOURCE', 'Content has been modified', {
        currentVersion: existingContent.version,
        message: 'Please retry with the current version',
      });
    }

    return respondSuccess(200, {
      id: updatedContent.id,
      userId: updatedContent.userId,
      title: updatedContent.title,
      description: updatedContent.description,
      contentType: updatedContent.contentType,
      visibility: updatedContent.visibility,
      publishDate: updatedContent.publishDate ? updatedContent.publishDate.toISOString() : null,
      captureDate: updatedContent.captureDate.toISOString(),
      tags: updatedContent.tags,
      metrics: updatedContent.metrics,
      isClaimed: updatedContent.isClaimed,
      originalAuthor: updatedContent.originalAuthor,
      urls: normalizeUrls({ id: updatedContent.id, urls: updatedContent.urls }),
      createdAt: updatedContent.createdAt.toISOString(),
      updatedAt: updatedContent.updatedAt.toISOString(),
      version: updatedContent.version,
    });
  } catch (error) {
    console.error('Failed to update content', { error, event });
    return respondError(500, 'INTERNAL_ERROR', 'Failed to update content');
  }
};
