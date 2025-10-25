import { handler } from '../../../../src/backend/lambdas/feedback/ingest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';

type FeedbackTestGlobals = typeof globalThis & { __feedbackDynamoClient?: DynamoDBClient };

describe('feedback/ingest lambda', () => {
  const originalEnv = process.env.FEEDBACK_TABLE_NAME;
  const originalFlag = process.env.ENABLE_BETA_FEATURES;

  beforeEach(() => {
    const g = globalThis as FeedbackTestGlobals;
    g.__feedbackDynamoClient = {
      send: jest.fn().mockResolvedValue({}),
    } as unknown as DynamoDBClient;
    process.env.FEEDBACK_TABLE_NAME = 'beta_feedback';
    process.env.ENABLE_BETA_FEATURES = 'true';
  });

  afterEach(() => {
    process.env.FEEDBACK_TABLE_NAME = originalEnv;
    process.env.ENABLE_BETA_FEATURES = originalFlag;
    delete (globalThis as FeedbackTestGlobals).__feedbackDynamoClient;
  });

  const createEvent = (body: Record<string, unknown>): APIGatewayProxyEvent =>
    ({
      httpMethod: 'POST',
      headers: { 'User-Agent': 'jest' } as any,
      body: JSON.stringify(body),
      isBase64Encoded: false,
      requestContext: {
        identity: { sourceIp: '127.0.0.1' },
        authorizer: { userId: 'user-123' },
      } as any,
    } as APIGatewayProxyEvent);

  it('stores feedback in DynamoDB with supplied metadata', async () => {
    const response = await handler(
      createEvent({
        category: 'bug',
        severity: 'p1',
        message: 'Button crashes on click',
        contact: 'tester@example.com',
        metadata: { page: '/dashboard' },
      })
    );

    expect(response.statusCode).toBe(202);
    const sendMock = (globalThis as FeedbackTestGlobals).__feedbackDynamoClient!.send as jest.Mock;
    expect(sendMock).toHaveBeenCalledTimes(1);
    const input = sendMock.mock.calls[0][0].input;
    expect(input.TableName).toBe('beta_feedback');
    expect(input.Item.severity.S).toBe('p1');
    expect(input.Item.contact.S).toBe('tester@example.com');
  });

  it('rejects malformed payloads', async () => {
    const response = await handler(
      createEvent({
        category: 'unknown',
        message: 'bad payload',
      })
    );

    expect(response.statusCode).toBe(400);
  });

  it('returns 403 when beta features are disabled', async () => {
    process.env.ENABLE_BETA_FEATURES = 'false';

    const response = await handler(
      createEvent({
        category: 'bug',
        severity: 'p3',
        message: 'Example feedback message',
      })
    );

    expect(response.statusCode).toBe(403);
  });
});
