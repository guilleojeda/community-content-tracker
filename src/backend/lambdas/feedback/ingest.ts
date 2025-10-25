import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../services/cors';

let dynamoSingleton: DynamoDBClient | null = null;

const resolveDynamoClient = (): DynamoDBClient => {
  const globalClient = (globalThis as { __feedbackDynamoClient?: DynamoDBClient }).__feedbackDynamoClient;
  if (globalClient) {
    return globalClient;
  }

  if (!dynamoSingleton) {
    dynamoSingleton = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  return dynamoSingleton;
};
const allowedCategories = ['bug', 'feature_request', 'usability', 'other'] as const;
const allowedSeverities = ['p0', 'p1', 'p2', 'p3', 'p4'] as const;

interface FeedbackPayload {
  category: typeof allowedCategories[number];
  severity: typeof allowedSeverities[number];
  message: string;
  contact?: string;
  metadata?: Record<string, unknown>;
}

function parseRequest(event: APIGatewayProxyEvent): FeedbackPayload | null {
  if (!event.body) {
    return null;
  }

  try {
    const payload = JSON.parse(event.body);
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const category = String(payload.category || '').toLowerCase();
    const severity = String(payload.severity || 'p2').toLowerCase();
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';

    if (!allowedCategories.includes(category as any)) {
      return null;
    }

    if (!allowedSeverities.includes(severity as any)) {
      return null;
    }

    if (message.length < 10 || message.length > 4000) {
      return null;
    }

    const contact = payload.contact ? String(payload.contact).trim() : undefined;
    const metadata = typeof payload.metadata === 'object' && payload.metadata !== null
      ? payload.metadata
      : undefined;

    return {
      category: category as FeedbackPayload['category'],
      severity: severity as FeedbackPayload['severity'],
      message,
      contact,
      metadata,
    };
  } catch (error) {
    return null;
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const corsOptions = { origin: originHeader, methods: 'POST,OPTIONS', allowCredentials: true };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: buildCorsHeaders(corsOptions),
      body: '',
    };
  }

  const tableName = process.env.FEEDBACK_TABLE_NAME;
  if ((process.env.ENABLE_BETA_FEATURES ?? 'false') !== 'true') {
    return {
      statusCode: 403,
      headers: buildCorsHeaders(corsOptions),
      body: JSON.stringify({
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Beta feedback collection is disabled in this environment',
        },
      }),
    };
  }

  if (!tableName) {
    return {
      statusCode: 500,
      headers: buildCorsHeaders(corsOptions),
      body: JSON.stringify({
        error: {
          code: 'CONFIGURATION_ERROR',
          message: 'Feedback table not configured',
        },
      }),
    };
  }

  const feedback = parseRequest(event);
  if (!feedback) {
    return {
      statusCode: 400,
      headers: buildCorsHeaders(corsOptions),
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid feedback payload',
        },
      }),
    };
  }

  const authorizer = event.requestContext.authorizer || {};
  const submittedBy = typeof authorizer.userId === 'string' ? authorizer.userId : null;

  const item = new PutItemCommand({
    TableName: tableName,
    Item: {
      id: { S: randomUUID() },
      category: { S: feedback.category },
      severity: { S: feedback.severity },
      message: { S: feedback.message },
      submittedAt: { S: new Date().toISOString() },
      submittedBy: submittedBy ? { S: submittedBy } : { NULL: true },
      contact: feedback.contact ? { S: feedback.contact } : { NULL: true },
      metadata: feedback.metadata ? { S: JSON.stringify(feedback.metadata).slice(0, 2048) } : { NULL: true },
      sourceIp: { S: event.requestContext.identity?.sourceIp || 'unknown' },
      userAgent: event.headers?.['User-Agent'] ? { S: event.headers['User-Agent'] } : { NULL: true },
    },
  });

  await resolveDynamoClient().send(item);

  return {
    statusCode: 202,
    headers: buildCorsHeaders(corsOptions),
    body: JSON.stringify({
      success: true,
      message: 'Feedback received',
    }),
  };
}
