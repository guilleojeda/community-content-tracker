import { ScheduledEvent, Context } from 'aws-lambda';
import { ChannelType, ContentType } from '../../../../src/shared/types';

// Set required environment variables BEFORE any imports that use them
process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/content-queue';
process.env.AWS_REGION = 'us-east-1';
process.env.GITHUB_TOKEN = 'ghp_test_token';

// Mock database pool FIRST
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn().mockResolvedValue(mockPool),
  closeDatabasePool: jest.fn(),
  setTestDatabasePool: jest.fn(),
  resetDatabaseCache: jest.fn(),
}));

// Mock ChannelRepository with class pattern
jest.mock('../../../../src/backend/repositories/ChannelRepository', () => {
  const mockFindActiveByType = jest.fn();
  const mockUpdateSyncStatus = jest.fn();

  class MockChannelRepository {
    findActiveByType = mockFindActiveByType;
    updateSyncStatus = mockUpdateSyncStatus;

    static mockFindActiveByType = mockFindActiveByType;
    static mockUpdateSyncStatus = mockUpdateSyncStatus;
  }

  return { ChannelRepository: MockChannelRepository };
});

// Create mock functions for AWS services
const mockSend = jest.fn();
const mockSecretsManagerSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: mockSecretsManagerSend,
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Import handler and services AFTER mocks are set up
import { handler } from '../../../../src/backend/lambdas/scrapers/github';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const mockChannelRepository = ChannelRepository as jest.MockedClass<typeof ChannelRepository>;
const mockSQSClient = SQSClient as jest.MockedClass<typeof SQSClient>;

// Access the mock methods from the mocked class
const mockFindActiveByType = (mockChannelRepository as any).mockFindActiveByType;
const mockUpdateSyncStatus = (mockChannelRepository as any).mockUpdateSyncStatus;

describe('GitHub Scraper Lambda', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {} as Context;

    // Reset to default environment variables
    process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/content-queue';
    process.env.AWS_REGION = 'us-east-1';
    process.env.GITHUB_TOKEN = 'ghp_test_token';
    delete process.env.GITHUB_TOKEN_SECRET_ARN;
  });

  const createScheduledEvent = (): ScheduledEvent => ({
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789',
    time: '2024-01-01T00:00:00Z',
    region: 'us-east-1',
    resources: ['arn:aws:events:us-east-1:123456789:rule/github-scraper'],
    detail: {},
    id: 'event-123',
    version: '0',
  });

  const mockGitHubRepoResponse = {
    name: 'test-repo',
    full_name: 'testowner/test-repo',
    description: 'A test repository',
    html_url: 'https://github.com/testowner/test-repo',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    pushed_at: '2024-01-15T09:00:00Z',
    stargazers_count: 100,
    forks_count: 25,
    language: 'TypeScript',
    topics: ['aws', 'lambda', 'scraper'],
  };

  const mockReadmeResponse = {
    content: Buffer.from('# Test Repository\n\nThis is a test README').toString('base64'),
    encoding: 'base64',
  };

  describe('Success Cases', () => {
    it('should successfully fetch and process a single repository', async () => {
      const channel = {
        id: 'channel-123',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'X-RateLimit-Remaining') return '4999';
              if (key === 'X-RateLimit-Reset') return '1640995200';
              return null;
            },
          },
          json: async () => mockGitHubRepoResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'X-RateLimit-Remaining') return '4998';
              if (key === 'X-RateLimit-Reset') return '1640995200';
              return null;
            },
          },
          json: async () => mockReadmeResponse,
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify repository API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testowner/test-repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_test_token',
            'Accept': 'application/vnd.github.v3+json',
          }),
        })
      );

      // Verify README API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testowner/test-repo/readme',
        expect.any(Object)
      );

      // Verify SQS message was sent
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: process.env.CONTENT_PROCESSING_QUEUE_URL,
            MessageBody: expect.stringContaining('testowner/test-repo'),
          }),
        })
      );

      // Verify sync status was updated
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(channel.id, 'success');
    });

    it('should successfully fetch organization repositories with pagination', async () => {
      const channel = {
        id: 'channel-789',
        userId: 'user-456',
        url: 'https://github.com/orgs/testorg',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: { type: 'organization' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      const repo1 = { ...mockGitHubRepoResponse, name: 'repo1', full_name: 'testorg/repo1' };
      const repo2 = { ...mockGitHubRepoResponse, name: 'repo2', full_name: 'testorg/repo2' };

      // Mock pagination responses
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'X-RateLimit-Remaining') return '4999';
              return null;
            },
          },
          json: async () => [repo1, repo2],
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify organization API was called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.github.com/orgs/testorg/repos'),
        expect.any(Object)
      );

      // Verify two SQS messages were sent
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should extract and decode README content correctly', async () => {
      const channel = {
        id: 'channel-readme',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      const readmeContent = '# Project Title\n\nDetailed description of the project';
      const encodedReadme = Buffer.from(readmeContent).toString('base64');

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '5000' },
          json: async () => mockGitHubRepoResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '4999' },
          json: async () => ({ content: encodedReadme }),
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify SQS message contains README content
      const sendCall = mockSend.mock.calls[0][0];
      const messageBody = JSON.parse(sendCall.input.MessageBody);
      expect(messageBody.description).toBe(readmeContent.substring(0, 500));
    });

    it('should send correct SQS message format', async () => {
      const channel = {
        id: 'channel-format',
        userId: 'user-789',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '5000' },
          json: async () => mockGitHubRepoResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '4999' },
          json: async () => mockReadmeResponse,
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      const sendCall = mockSend.mock.calls[0][0];
      const messageBody = JSON.parse(sendCall.input.MessageBody);

      expect(messageBody).toMatchObject({
        userId: 'user-789',
        channelId: 'channel-format',
        title: 'testowner/test-repo',
        contentType: ContentType.GITHUB,
        url: 'https://github.com/testowner/test-repo',
        publishDate: '2024-01-01T00:00:00Z',
        metadata: {
          stars: 100,
          forks: 25,
          language: 'TypeScript',
          topics: ['aws', 'lambda', 'scraper'],
          updatedAt: '2024-01-15T10:00:00Z',
          pushedAt: '2024-01-15T09:00:00Z',
        },
      });

      expect(sendCall.input.MessageAttributes).toMatchObject({
        contentType: {
          DataType: 'String',
          StringValue: ContentType.GITHUB,
        },
        channelId: {
          DataType: 'String',
          StringValue: 'channel-format',
        },
      });
    });

    it('should filter repositories by lastSyncAt date', async () => {
      const lastSyncAt = new Date('2024-01-10T00:00:00Z');
      const channel = {
        id: 'channel-filter',
        userId: 'user-456',
        url: 'https://github.com/orgs/testorg',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt,
        syncFrequency: 'daily' as const,
        metadata: { type: 'organization' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      const oldRepo = {
        ...mockGitHubRepoResponse,
        name: 'old-repo',
        updated_at: '2024-01-05T00:00:00Z'
      };
      const newRepo = {
        ...mockGitHubRepoResponse,
        name: 'new-repo',
        updated_at: '2024-01-15T00:00:00Z'
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => [oldRepo, newRepo],
      });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Only new repo should be sent to SQS
      expect(mockSend).toHaveBeenCalledTimes(1);
      const messageBody = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
      expect(messageBody.title).toContain('new-repo');
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limit detection and throw error', async () => {
      const channel = {
        id: 'channel-rate-limit',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'X-RateLimit-Remaining') return '0';
            if (key === 'X-RateLimit-Reset') return '1640995200';
            return null;
          },
        },
      });

      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify error status was updated
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        channel.id,
        'error',
        expect.stringContaining('rate limit exceeded')
      );
    });

    it('should handle 404 errors for non-existent repositories', async () => {
      const channel = {
        id: 'channel-404',
        userId: 'user-456',
        url: 'https://github.com/testowner/nonexistent',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        headers: { get: () => '5000' },
      });

      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        channel.id,
        'error',
        'GitHub API error: Not Found'
      );
    });

    it('should handle network errors gracefully', async () => {
      const channel = {
        id: 'channel-network',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network timeout'));

      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        channel.id,
        'error',
        'Network timeout'
      );
    });

    it('should handle SQS send failures', async () => {
      const channel = {
        id: 'channel-sqs-error',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '5000' },
          json: async () => mockGitHubRepoResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '4999' },
          json: async () => mockReadmeResponse,
        });

      mockSend.mockRejectedValueOnce(new Error('SQS is unavailable'));
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Error should be logged but not crash the lambda
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        channel.id,
        'error',
        expect.any(String)
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle repositories without README', async () => {
      const channel = {
        id: 'channel-no-readme',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '5000' },
          json: async () => mockGitHubRepoResponse,
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
          headers: { get: () => '4999' },
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should still send message with description from repo
      expect(mockSend).toHaveBeenCalledTimes(1);
      const messageBody = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
      expect(messageBody.description).toBe('A test repository');
    });

    it('should handle empty organization with no repositories', async () => {
      const channel = {
        id: 'channel-empty-org',
        userId: 'user-456',
        url: 'https://github.com/orgs/emptyorg',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: { type: 'organization' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => [],
      });

      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // No messages should be sent
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(channel.id, 'success');
    });

    it('should handle invalid GitHub URLs', async () => {
      const channel = {
        id: 'channel-invalid-url',
        userId: 'user-456',
        url: 'https://invalid-url.com/not-github',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        channel.id,
        'error',
        'Invalid GitHub URL'
      );
    });

    it('should handle repositories without description or README', async () => {
      const channel = {
        id: 'channel-no-desc',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const repoWithoutDescription = {
        ...mockGitHubRepoResponse,
        description: null,
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '5000' },
          json: async () => repoWithoutDescription,
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
          headers: { get: () => '4999' },
        });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      const messageBody = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
      expect(messageBody.description).toBeUndefined();
    });

    it('should handle no active channels', async () => {
      mockFindActiveByType.mockResolvedValue([]);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockSend).not.toHaveBeenCalled();
      expect(mockUpdateSyncStatus).not.toHaveBeenCalled();
    });
  });

  describe('GitHub Token Authorization', () => {
    it('should include GitHub token in requests when available', async () => {
      process.env.GITHUB_TOKEN = 'ghp_secret_token';

      const channel = {
        id: 'channel-auth',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => mockGitHubRepoResponse,
      });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_secret_token',
          }),
        })
      );
    });

    it('should work without GitHub token', async () => {
      delete process.env.GITHUB_TOKEN;

      const channel = {
        id: 'channel-no-auth',
        userId: 'user-456',
        url: 'https://github.com/testowner/test-repo',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '60' },
        json: async () => mockGitHubRepoResponse,
      });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String),
          }),
        })
      );
    });
  });

  describe('Secrets Manager Token Retrieval', () => {
    const createTestChannel = () => ({
      id: 'channel-secrets',
      userId: 'user-456',
      url: 'https://github.com/testowner/test-repo',
      channelType: ChannelType.GITHUB,
      enabled: true,
      lastSyncAt: undefined,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const setupMocks = (testChannel: ReturnType<typeof createTestChannel>) => {
      mockFindActiveByType.mockResolvedValue([testChannel]);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => mockGitHubRepoResponse,
      });
      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(testChannel);
    };

    it('should successfully retrieve token from Secrets Manager', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      delete process.env.GITHUB_TOKEN;

      mockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: 'ghp_secrets_manager_token',
      });

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify Secrets Manager was called with correct ARN
      expect(mockSecretsManagerSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            SecretId: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123',
          }),
        })
      );

      // Verify token was used in GitHub API call
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_secrets_manager_token',
          }),
        })
      );
    });

    it('should cache token after first Secrets Manager retrieval', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      delete process.env.GITHUB_TOKEN;

      mockSecretsManagerSend.mockResolvedValue({
        SecretString: 'ghp_cached_token',
      });

      mockFindActiveByType.mockResolvedValue([testChannel, testChannel]);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Secrets Manager should only be called once (token is cached)
      expect(mockSecretsManagerSend).toHaveBeenCalledTimes(1);

      // But GitHub API should be called multiple times with cached token
      const githubCalls = (global.fetch as jest.Mock).mock.calls.filter(
        call => call[0].includes('api.github.com')
      );
      expect(githubCalls.length).toBeGreaterThan(1);
    });

    it('should fallback to GITHUB_TOKEN env var when Secrets Manager fails', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      process.env.GITHUB_TOKEN = 'ghp_fallback_env_token';

      const secretsError = new Error('AccessDeniedException: User not authorized');
      secretsError.name = 'AccessDeniedException';
      mockSecretsManagerSend.mockRejectedValueOnce(secretsError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify Secrets Manager was attempted
      expect(mockSecretsManagerSend).toHaveBeenCalled();

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch GitHub token from Secrets Manager')
      );

      // Verify fallback to env var
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_fallback_env_token',
          }),
        })
      );

      consoleErrorSpy.mockRestore();
    });

    it('should work without token when both Secrets Manager and env var fail', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      delete process.env.GITHUB_TOKEN;

      mockSecretsManagerSend.mockRejectedValueOnce(new Error('ResourceNotFoundException'));

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should work without Authorization header
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.anything(),
          }),
        })
      );
    });

    it('should handle Secrets Manager returning empty SecretString', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      delete process.env.GITHUB_TOKEN;

      mockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: undefined,
      });

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should work without Authorization header
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.anything(),
          }),
        })
      );
    });

    it('should handle Secrets Manager ThrottlingException', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      process.env.GITHUB_TOKEN = 'ghp_backup_token';

      const throttlingError = new Error('ThrottlingException: Rate exceeded');
      throttlingError.name = 'ThrottlingException';
      mockSecretsManagerSend.mockRejectedValueOnce(throttlingError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should not crash and fallback to env var
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_backup_token',
          }),
        })
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle Secrets Manager timeout errors', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      delete process.env.GITHUB_TOKEN;

      const timeoutError = new Error('TimeoutError: Request timed out');
      timeoutError.name = 'TimeoutError';
      mockSecretsManagerSend.mockRejectedValueOnce(timeoutError);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should continue execution without crashing
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(testChannel.id, 'success');
    });

    it('should prefer Secrets Manager over env var when both are available', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      process.env.GITHUB_TOKEN = 'ghp_env_token';

      mockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: 'ghp_secrets_priority_token',
      });

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Should use Secrets Manager token, not env var
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_secrets_priority_token',
          }),
        })
      );
    });

    it('should use GITHUB_TOKEN directly when SECRET_ARN is not configured', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      delete process.env.GITHUB_TOKEN_SECRET_ARN;
      process.env.GITHUB_TOKEN = 'ghp_direct_env_token';

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Secrets Manager should not be called
      expect(mockSecretsManagerSend).not.toHaveBeenCalled();

      // Should use env var token directly
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_direct_env_token',
          }),
        })
      );
    });

    it('should cache fallback env var token after Secrets Manager failure', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      process.env.GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token-abc123';
      process.env.GITHUB_TOKEN = 'ghp_cached_fallback';

      mockSecretsManagerSend.mockRejectedValue(new Error('Service unavailable'));
      mockFindActiveByType.mockResolvedValue([testChannel, testChannel]);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Secrets Manager should only be attempted once
      expect(mockSecretsManagerSend).toHaveBeenCalledTimes(1);

      // All GitHub API calls should use the cached fallback token
      const githubCalls = (global.fetch as jest.Mock).mock.calls.filter(
        call => call[0].includes('api.github.com')
      );
      githubCalls.forEach(call => {
        expect(call[1].headers.Authorization).toBe('token ghp_cached_fallback');
      });
    });

    it('should handle no token configured gracefully (lower rate limits)', async () => {
      const testChannel = createTestChannel();
      setupMocks(testChannel);

      delete process.env.GITHUB_TOKEN_SECRET_ARN;
      delete process.env.GITHUB_TOKEN;

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Secrets Manager should not be called
      expect(mockSecretsManagerSend).not.toHaveBeenCalled();

      // Should make unauthenticated requests
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'AWS-Community-Content-Hub',
          }),
        })
      );

      // But no Authorization header
      const githubCall = (global.fetch as jest.Mock).mock.calls.find(
        call => call[0].includes('api.github.com')
      );
      expect(githubCall[1].headers.Authorization).toBeUndefined();
    });
  });

  describe('Metadata Filtering', () => {
    it('should filter organization repositories by language metadata', async () => {
      const channel = {
        id: 'channel-language',
        userId: 'user-456',
        url: 'https://github.com/orgs/testorg',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: { type: 'organization', language: 'TypeScript' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      const tsRepo = { ...mockGitHubRepoResponse, name: 'ts-repo', full_name: 'testorg/ts-repo', language: 'TypeScript' };
      const pyRepo = { ...mockGitHubRepoResponse, name: 'py-repo', full_name: 'testorg/py-repo', language: 'Python' };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => [tsRepo, pyRepo],
      });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
      expect(body.title).toContain('ts-repo');
    });

    it('should filter repositories by topics metadata and skip non-matching repos', async () => {
      const channel = {
        id: 'channel-topics',
        userId: 'user-456',
        url: 'https://github.com/orgs/testorg',
        channelType: ChannelType.GITHUB,
        enabled: true,
        lastSyncAt: undefined,
        syncFrequency: 'daily' as const,
        metadata: { type: 'organization', topics: ['aws', 'serverless'] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindActiveByType.mockResolvedValue([channel]);

      const awsRepo = { ...mockGitHubRepoResponse, name: 'aws-tool', full_name: 'testorg/aws-tool', topics: ['AWS', 'Lambda'] };
      const otherRepo = { ...mockGitHubRepoResponse, name: 'random-tool', full_name: 'testorg/random-tool', topics: ['typescript'] };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '5000' },
        json: async () => [awsRepo, otherRepo],
      });

      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue(channel);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const messageBody = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
      expect(messageBody.title).toContain('aws-tool');
    });
  });
});
