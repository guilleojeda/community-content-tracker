import { ScheduledEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, ContentType, ContentProcessorMessage } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, ThrottlingError, ValidationError, formatErrorForLogging } from '../../../shared/errors';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Validate required environment variables at module load
function validateEnvironment(): void {
  const required = ['CONTENT_PROCESSING_QUEUE_URL'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnvironment();

const QUEUE_URL = process.env.CONTENT_PROCESSING_QUEUE_URL as string;
const GITHUB_TOKEN_SECRET_ARN = process.env.GITHUB_TOKEN_SECRET_ARN;

// Cache for GitHub token to avoid repeated Secrets Manager calls
let cachedGitHubToken: string | null = null;

async function getGitHubToken(): Promise<string | null> {
  // Return cached token if available
  if (cachedGitHubToken) {
    return cachedGitHubToken;
  }

  // Try to get from Secrets Manager first
  if (GITHUB_TOKEN_SECRET_ARN) {
    try {
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: GITHUB_TOKEN_SECRET_ARN,
      }));

      if (response.SecretString) {
        cachedGitHubToken = response.SecretString;
        return cachedGitHubToken;
      }
    } catch (error: any) {
      const secretsError = new ExternalApiError(
        'SecretsManager',
        'Failed to fetch GitHub token from Secrets Manager',
        500,
        {
          secretArn: GITHUB_TOKEN_SECRET_ARN,
          originalError: error.message,
        }
      );
      console.error(formatErrorForLogging(secretsError, { secretArn: GITHUB_TOKEN_SECRET_ARN }));
      // Fall through to environment variable
    }
  }

  // Fallback to environment variable for local development
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    cachedGitHubToken = envToken;
    return cachedGitHubToken;
  }

  // Return null if no token configured (GitHub API will work with lower rate limits)
  return null;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  readme?: string;
}

function extractOwnerAndRepo(url: string): { owner: string; repo: string } | null {
  // Support various GitHub URL formats
  const pattern = /github\.com\/([^\/]+)\/([^\/\?#]+)/;
  const match = url.match(pattern);

  if (match) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }

  return null;
}

async function fetchWithGitHub(url: string): Promise<Response> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AWS-Community-Content-Hub',
  };

  const token = await getGitHubToken();
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(url, { headers });

  // Check rate limiting
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (remaining === '0') {
    const resetDate = new Date(parseInt(reset || '0') * 1000);
    const rateLimitError = new ThrottlingError('GitHub', resetDate);
    console.error(formatErrorForLogging(rateLimitError, { url, resetDate: resetDate.toISOString() }));
    throw rateLimitError;
  }

  if (!response.ok) {
    const apiError = new ExternalApiError(
      'GitHub',
      `GitHub API error: ${response.statusText}`,
      response.status,
      { url, statusText: response.statusText }
    );
    console.error(formatErrorForLogging(apiError, { url }));
    throw apiError;
  }

  return response;
}

async function fetchRepositoryDetails(owner: string, repo: string): Promise<GitHubRepo> {
  const response = await fetchWithGitHub(
    `https://api.github.com/repos/${owner}/${repo}`
  );

  const data = await response.json();

  // Fetch README
  let readme: string | undefined;
  try {
    const readmeResponse = await fetchWithGitHub(
      `https://api.github.com/repos/${owner}/${repo}/readme`
    );
    const readmeData = await readmeResponse.json();
    if (readmeData.content) {
      readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
    }
  } catch (error) {
    console.warn(`Could not fetch README for ${owner}/${repo}`);
  }

  return {
    name: data.name,
    full_name: data.full_name,
    description: data.description,
    html_url: data.html_url,
    created_at: data.created_at,
    updated_at: data.updated_at,
    pushed_at: data.pushed_at,
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    language: data.language,
    topics: data.topics || [],
    readme,
  };
}

async function fetchOrganizationRepos(org: string, lastSyncAt?: Date): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetchWithGitHub(
      `https://api.github.com/orgs/${org}/repos?per_page=${perPage}&page=${page}&sort=updated`
    );

    const data = await response.json();

    if (data.length === 0) {
      break;
    }

    for (const repo of data) {
      const updatedAt = new Date(repo.updated_at);

      // Filter by lastSyncAt if provided
      if (lastSyncAt && updatedAt <= lastSyncAt) {
        continue;
      }

      repos.push({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        language: repo.language,
        topics: repo.topics || [],
      });
    }

    if (data.length < perPage) {
      break;
    }

    page++;
  }

  return repos;
}

async function sendToQueue(channelId: string, userId: string, repo: GitHubRepo): Promise<void> {
  const description = repo.description || (repo.readme ? repo.readme.substring(0, 500) : undefined);

  // Explicitly type the message as ContentProcessorMessage
  const message: ContentProcessorMessage = {
    userId,
    channelId,
    title: repo.full_name,
    description,
    contentType: ContentType.GITHUB,
    url: repo.html_url,
    publishDate: repo.created_at,
    metadata: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      topics: repo.topics,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
    },
  };

  try {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        contentType: {
          DataType: 'String',
          StringValue: ContentType.GITHUB,
        },
        channelId: {
          DataType: 'String',
          StringValue: channelId,
        },
      },
    }));
  } catch (error: any) {
    const sqsError = new ExternalApiError('SQS', `Failed to send message to queue`, 500, {
      channelId,
      userId,
      repoFullName: repo.full_name,
      queueUrl: QUEUE_URL,
      originalError: error.message,
    });
    console.error(formatErrorForLogging(sqsError, { channelId, userId, repoFullName: repo.full_name }));
    throw sqsError;
  }
}

export const handler = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  console.log('Starting GitHub Repository scraper');

  const pool = await getDatabasePool();
  const channelRepository = new ChannelRepository(pool);

  try {
    // Get all enabled GitHub channels
    const channels = await channelRepository.findActiveByType(ChannelType.GITHUB);

    console.log(`Found ${channels.length} active GitHub channels`);

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const channel of channels) {
      try {
        console.log(`Processing channel: ${channel.id} (${channel.url})`);

        const parsed = extractOwnerAndRepo(channel.url);
        if (!parsed) {
          const validationError = new ValidationError(
            'Invalid GitHub URL',
            { channelId: channel.id, url: channel.url }
          );
          console.error(formatErrorForLogging(validationError, { channelId: channel.id, url: channel.url }));
          throw validationError;
        }

        const { owner, repo } = parsed;
        let repos: GitHubRepo[] = [];

        // Check if this is an organization (based on metadata or URL pattern)
        const isOrg = channel.url.includes('/orgs/') ||
                     channel.metadata?.type === 'organization';

        if (isOrg) {
          // Fetch all repos from organization
          repos = await fetchOrganizationRepos(owner, channel.lastSyncAt);
        } else if (repo && repo !== owner) {
          // Fetch single repository
          const repoDetails = await fetchRepositoryDetails(owner, repo);

          const updatedAt = new Date(repoDetails.updated_at);
          if (!channel.lastSyncAt || updatedAt > channel.lastSyncAt) {
            repos = [repoDetails];
          }
        }

        console.log(`Found ${repos.length} repositories to process for channel ${channel.id}`);

        // Send each repo to the processing queue
        for (const repoData of repos) {
          try {
            await sendToQueue(channel.id, channel.userId, repoData);
            totalProcessed++;
          } catch (error: any) {
            console.error(formatErrorForLogging(error, { channelId: channel.id, repoFullName: repoData.full_name }));
            totalErrors++;
          }
        }

        // Update sync status
        await channelRepository.updateSyncStatus(channel.id, 'success');
      } catch (error: any) {
        console.error(formatErrorForLogging(error, { channelId: channel.id, channelUrl: channel.url }));
        await channelRepository.updateSyncStatus(
          channel.id,
          'error',
          error.message || 'Unknown error'
        );
        totalErrors++;
      }
    }

    console.log(
      `GitHub scraper completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`
    );
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { source: 'github-scraper-handler' }));
    throw error;
  }
};
