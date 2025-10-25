import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { EmbeddingService } from '../../services/EmbeddingService';
import { buildCorsHeaders } from '../../services/cors';

// DynamoDB client initialization
let dynamoClient: DynamoDBClient | null = null;
let embeddingService: EmbeddingService | null = null;

/**
 * Get DynamoDB client instance
 */
function getDynamoClient(): DynamoDBClient {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return dynamoClient;
}

/**
 * Get EmbeddingService instance
 */
function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}

/**
 * Create CORS headers
 */
function getCorsHeaders(origin?: string | null) {
  return {
    ...buildCorsHeaders({ origin, methods: 'OPTIONS,PUT', allowCredentials: true }),
    'Content-Type': 'application/json',
  };
}

/**
 * Create error response
 */
function createErrorResponse(
  statusCode: number,
  message: string,
  details?: any,
  origin?: string | null
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: getCorsHeaders(origin),
    body: JSON.stringify({
      error: message,
      ...(details && { ...details }),
    }),
  };
}

/**
 * Create success response
 */
function createSuccessResponse(
  statusCode: number,
  data: any,
  origin?: string | null
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: getCorsHeaders(origin),
    body: JSON.stringify(data),
  };
}

/**
 * Check if user is admin
 */
function isAdmin(event: APIGatewayProxyEvent): boolean {
  const groups = event.requestContext?.authorizer?.claims?.['cognito:groups'];
  if (!groups) return false;

  try {
    const groupsArray = typeof groups === 'string' ? JSON.parse(groups) : groups;
    return Array.isArray(groupsArray) && groupsArray.includes('Admins');
  } catch {
    return false;
  }
}

/**
 * Get authenticated user ID
 */
function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub || null;
}

/**
 * Validate visibility value
 */
function validateVisibility(visibility: string): boolean {
  const validValues = ['public', 'private', 'aws_only', 'aws_community'];
  return validValues.includes(visibility);
}

/**
 * Validate tags array
 */
function validateTags(tags: any): { valid: boolean; error?: string } {
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'Tags must be an array' };
  }

  if (tags.length > 50) {
    return { valid: false, error: 'Tags must not exceed maximum of 50' };
  }

  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'All tags must be strings' };
    }
  }

  return { valid: true };
}

/**
 * Validate update request body
 */
function validateUpdateRequest(body: any): { valid: boolean; error?: string } {
  if (!body.version || typeof body.version !== 'number') {
    return { valid: false, error: 'version is required for optimistic locking' };
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      return { valid: false, error: 'title must be a string' };
    }
    if (body.title.length > 500) {
      return { valid: false, error: 'title must not exceed maximum length of 500 characters' };
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return { valid: false, error: 'description must be a string' };
    }
    if (body.description.length > 5000) {
      return { valid: false, error: 'description must not exceed maximum length' };
    }
  }

  if (body.visibility !== undefined) {
    if (!validateVisibility(body.visibility)) {
      return { valid: false, error: 'Invalid visibility value' };
    }
  }

  if (body.tags !== undefined) {
    const tagsValidation = validateTags(body.tags);
    if (!tagsValidation.valid) {
      return { valid: false, error: tagsValidation.error };
    }
  }

  return { valid: true };
}

/**
 * PUT /content/:id Lambda handler
 * Updates existing content with authorization and optimistic locking
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Update content request:', JSON.stringify(event, null, 2));

  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const respondError = (statusCode: number, message: string, details?: any) =>
    createErrorResponse(statusCode, message, details, originHeader);
  const respondSuccess = (statusCode: number, data: any) =>
    createSuccessResponse(statusCode, data, originHeader);

  const tableName = process.env.CONTENT_TABLE_NAME;
  if (!tableName) {
    console.error('CONTENT_TABLE_NAME environment variable not set');
    return respondError(500, 'Failed to update content: Configuration error');
  }

  try {
    // Check authentication
    if (!event.requestContext?.authorizer) {
      return respondError(401, 'Unauthorized: Authentication required');
    }

    const userId = getUserId(event);
    if (!userId) {
      return respondError(401, 'Unauthorized: Invalid user credentials');
    }

    // Get content ID from path
    const contentId = event.pathParameters?.id;
    if (!contentId) {
      return respondError(400, 'Content ID is required');
    }

    // Parse and validate request body
    let updateBody: any;
    try {
      updateBody = JSON.parse(event.body || '{}');
    } catch {
      return respondError(400, 'Invalid JSON in request body');
    }

    // Validate update request
    const validation = validateUpdateRequest(updateBody);
    if (!validation.valid) {
      return respondError(400, validation.error!);
    }

    const client = getDynamoClient();

    // Get existing content
    const getCommand = new GetItemCommand({
      TableName: tableName,
      Key: marshall({ id: contentId }),
    });

    const getResult = await client.send(getCommand);

    if (!getResult.Item) {
      return respondError(404, 'Content not found');
    }

    const existingContent = unmarshall(getResult.Item);

    // Check authorization (owner or admin)
    const userIsAdmin = isAdmin(event);
    const isOwner = existingContent.userId === userId;

    if (!isOwner && !userIsAdmin) {
      return respondError(403, 'You are not authorized to update this content');
    }

    // Check optimistic locking
    if (existingContent.version !== updateBody.version) {
      return respondError(409, 'version conflict: Content has been modified', {
        currentVersion: existingContent.version,
        message: 'Please retry with the current version',
      });
    }

    // Build update expression
    const updates: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};
    let attrIndex = 0;

    // Update fields if provided
    if (updateBody.title !== undefined) {
      const attrName = `#attr${attrIndex}`;
      const attrValue = `:val${attrIndex}`;
      expressionAttributeNames[attrName] = 'title';
      expressionAttributeValues[attrValue] = updateBody.title;
      updates.push(`${attrName} = ${attrValue}`);
      attrIndex++;
    }

    if (updateBody.description !== undefined) {
      const attrName = `#attr${attrIndex}`;
      const attrValue = `:val${attrIndex}`;
      expressionAttributeNames[attrName] = 'description';
      expressionAttributeValues[attrValue] = updateBody.description;
      updates.push(`${attrName} = ${attrValue}`);
      attrIndex++;
    }

    if (updateBody.visibility !== undefined) {
      const attrName = `#attr${attrIndex}`;
      const attrValue = `:val${attrIndex}`;
      expressionAttributeNames[attrName] = 'visibility';
      expressionAttributeValues[attrValue] = updateBody.visibility;
      updates.push(`${attrName} = ${attrValue}`);
      attrIndex++;
    }

    if (updateBody.tags !== undefined) {
      const attrName = `#attr${attrIndex}`;
      const attrValue = `:val${attrIndex}`;
      expressionAttributeNames[attrName] = 'tags';
      expressionAttributeValues[attrValue] = updateBody.tags;
      updates.push(`${attrName} = ${attrValue}`);
      attrIndex++;
    }

    // Regenerate embedding if content changed
    const needsEmbeddingUpdate =
      updateBody.title !== undefined ||
      updateBody.description !== undefined ||
      updateBody.tags !== undefined;

    if (needsEmbeddingUpdate) {
      const embeddingText = `${updateBody.title || existingContent.title} ${updateBody.description || existingContent.description || ''}`.trim();

      if (embeddingText) {
        try {
          const embedService = getEmbeddingService();
          const embedding = await embedService.generateEmbedding(embeddingText);

          const embeddingAttrName = `#attr${attrIndex}`;
          const embeddingAttrValue = `:val${attrIndex}`;
          expressionAttributeNames[embeddingAttrName] = 'embedding';
          expressionAttributeValues[embeddingAttrValue] = `[${embedding.join(',')}]`;
          updates.push(`${embeddingAttrName} = ${embeddingAttrValue}`);
          attrIndex++;

          console.log('Embedding regenerated for content update');
        } catch (error) {
          console.error('Failed to generate embedding:', error);
          // Continue with update even if embedding fails
        }
      }
    }

    // Always update version and updatedAt
    const versionAttrName = `#attr${attrIndex}`;
    const versionAttrValue = `:val${attrIndex}`;
    expressionAttributeNames[versionAttrName] = 'version';
    expressionAttributeValues[versionAttrValue] = existingContent.version + 1;
    updates.push(`${versionAttrName} = ${versionAttrValue}`);
    attrIndex++;

    const updatedAtAttrName = `#attr${attrIndex}`;
    const updatedAtAttrValue = `:val${attrIndex}`;
    expressionAttributeNames[updatedAtAttrName] = 'updatedAt';
    expressionAttributeValues[updatedAtAttrValue] = new Date().toISOString();
    updates.push(`${updatedAtAttrName} = ${updatedAtAttrValue}`);

    // Perform update
    const updateCommand = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ id: contentId }),
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ReturnValues: 'ALL_NEW',
    });

    const updateResult = await client.send(updateCommand);

    if (!updateResult.Attributes) {
      return respondError(500, 'Failed to update content: No attributes returned');
    }

    const updatedContent = unmarshall(updateResult.Attributes);

    console.log('Content updated successfully:', contentId);
    return respondSuccess(200, updatedContent);

  } catch (error: any) {
    console.error('Error updating content:', error);

    if (error.name === 'ConditionalCheckFailedException') {
      return respondError(409, 'version conflict: Content has been modified');
    }

    return respondError(500, 'Failed to update content');
  }
}
