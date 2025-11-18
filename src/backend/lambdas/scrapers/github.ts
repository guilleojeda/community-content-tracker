import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, ContentType, ContentProcessorMessage } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, ThrottlingError, ValidationError, formatErrorForLogging } from '../../../shared/errors';
import { createSendMessageCommand } from '../../utils/sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

let cachedQueueUrl: string | null = null;
function resolveQueueUrl(): string {
  if (cachedQueueUrl) {
    return cachedQueueUrl;
  }

  const value = process.env.CONTENT_PROCESSING_QUEUE_URL;
  if (!value || value.trim() === '') {
    throw new Error('Missing required environment variables: CONTENT_PROCESSING_QUEUE_URL');
  }

  cachedQueueUrl = value;
  return cachedQueueUrl;
}
// Cache for GitHub token to avoid repeated Secrets Manager calls
let cachedGitHubToken: string | null = null;
let cachedGitHubTokenResolved = false;
let cachedTokenSignature: string | null = null;

function getTokenSourceSignature(secretArn?: string, envToken?: string): string {
  return `${secretArn ?? ''}|${envToken ?? ''}`;
}

export function resetGitHubTokenCache(): void {
  cachedGitHubToken = null;
  cachedGitHubTokenResolved = false;
  cachedTokenSignature = null;
}

async function getGitHubToken(): Promise<string | null> {
  const secretArn = process.env.GITHUB_TOKEN_SECRET_ARN?.trim();
  const envTokenRaw = process.env.GITHUB_TOKEN;
  const envToken = envTokenRaw && envTokenRaw.trim() !== '' ? envTokenRaw : undefined;

  const signature = getTokenSourceSignature(secretArn, envToken);

  if (cachedTokenSignature !== signature) {
    cachedTokenSignature = signature;
    cachedGitHubToken = null;
    cachedGitHubTokenResolved = false;
  }

  if (cachedGitHubTokenResolved) {
    return cachedGitHubToken;
  }

  // Try to get from Secrets Manager first
  if (secretArn) {
    try {
      const commandInput = { SecretId: secretArn };
      const command = new GetSecretValueCommand(commandInput);
      if (!(command as any).input) {
        (command as any).input = commandInput;
      }

      const response = await secretsClient.send(command);

      const secretValue = response.SecretString?.trim();
      if (secretValue) {
        cachedGitHubToken = secretValue;
        cachedGitHubTokenResolved = true;
        return cachedGitHubToken;
      }
    } catch (error: any) {
      const secretsError = new ExternalApiError(
        'SecretsManager',
        'Failed to fetch GitHub token from Secrets Manager',
        500,
        {
          secretArn,
          originalError: error.message,
        }
      );
      console.error(JSON.stringify(formatErrorForLogging(secretsError, { secretArn })));
      // Fall through to environment variable
    }
  }

  // Fallback to environment variable for local development
  if (envToken) {
    cachedGitHubToken = envToken;
    cachedGitHubTokenResolved = true;
    return cachedGitHubToken;
  }

  // Return null if no token configured (GitHub API will work with lower rate limits)
  cachedGitHubToken = null;
  cachedGitHubTokenResolved = true;
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

function normalizeFilterValues(value: unknown): string[] {
  if (!value && value !== 0) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter(item => typeof item === 'string')
      .map(item => item.toLowerCase().trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(part => part.toLowerCase().trim())
      .filter(Boolean);
  }

  return [];
}

function extractFilterValues(
  metadata: Record<string, any> | undefined,
  keys: string[]
): string[] {
  if (!metadata) {
    return [];
  }

  const values: string[] = [];
  for (const key of keys) {
    values.push(...normalizeFilterValues(metadata[key]));
  }
  return values;
}

function filterReposByMetadata(repos: GitHubRepo[], metadata?: Record<string, any>): GitHubRepo[] {
  if (!metadata) {
    return repos;
  }

  const languageFilters = extractFilterValues(metadata, ['language', 'languages', 'languageFilter', 'languageFilters']);
  const topicFilters = extractFilterValues(metadata, ['topic', 'topics', 'topicFilter', 'topicFilters']);

  if (languageFilters.length === 0 && topicFilters.length === 0) {
    return repos;
  }

  return repos.filter(repo => {
    if (languageFilters.length > 0) {
      const repoLanguage = repo.language?.toLowerCase();
      if (!repoLanguage || !languageFilters.includes(repoLanguage)) {
        return false;
      }
    }

    if (topicFilters.length > 0) {
      const repoTopics = (repo.topics || []).map(topic => topic.toLowerCase());
      if (!repoTopics.some(topic => topicFilters.includes(topic))) {
        return false;
      }
    }

    return true;
  });
}

function extractOwnerAndRepo(url: string): { owner: string; repo: string } | null {
  // Support various GitHub URL formats
  const pattern = /github\.com\/([^/]+)\/([^/?#]+)/;
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

  let hasMore = true;
  while (hasMore) {
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

      const fullName = `${org}/${repo.name}`;

      repos.push({
        name: repo.name,
        full_name: fullName,
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
      hasMore = false;
    } else {
      page++;
    }
  }

  return repos;
}

async function sendToQueue(channelId: string, userId: string, repo: GitHubRepo): Promise<void> {
  const readmeSnippet = repo.readme ? repo.readme.substring(0, 500) : undefined;
  const description = readmeSnippet ?? repo.description ?? undefined;
  const title = repo.full_name && repo.full_name.trim().length > 0
    ? repo.full_name
    : repo.name;

  // Explicitly type the message as ContentProcessorMessage
  const message: ContentProcessorMessage = {
    userId,
    channelId,
    title,
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
    const queueUrl = resolveQueueUrl();
    const commandInput = {
      QueueUrl: queueUrl,
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
    };
    const command = createSendMessageCommand(commandInput);
    await sqsClient.send(command);
  } catch (error: any) {
    const sqsError = new ExternalApiError('SQS', `Failed to send message to queue`, 500, {
      channelId,
      userId,
      repoFullName: repo.full_name,
      queueUrl: resolveQueueUrl(),
      originalError: error.message,
    });
    console.error(formatErrorForLogging(sqsError, { channelId, userId, repoFullName: repo.full_name }));
    throw sqsError;
  }
}

export const handler = async (
  _event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (process.env.NODE_ENV === 'test') {
    resetGitHubTokenCache();
  }

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
        const orgMatch = channel.url.match(/github\.com\/orgs\/([^/?#]+)/);
        const metadataOrg = channel.metadata?.organization || channel.metadata?.org;
        let organization = orgMatch ? orgMatch[1] : metadataOrg;
        if (!organization && parsed.owner === 'orgs' && parsed.repo) {
          organization = parsed.repo;
        }
        const isOrg = !!organization || channel.metadata?.type === 'organization';

        if (isOrg) {
          // Fetch all repos from organization
          const orgName = organization ?? owner;
          repos = await fetchOrganizationRepos(orgName, channel.lastSyncAt);
        } else if (repo && repo !== owner) {
          // Fetch single repository
          const repoDetails = await fetchRepositoryDetails(owner, repo);

          const updatedAt = new Date(repoDetails.updated_at);
          if (!channel.lastSyncAt || updatedAt > channel.lastSyncAt) {
            repos = [repoDetails];
          }
        }

        const filteredRepos = filterReposByMetadata(repos, channel.metadata);
        console.log(`Found ${repos.length} repositories to process for channel ${channel.id} (after filters: ${filteredRepos.length})`);

        // Send each repo to the processing queue
        for (const repoData of filteredRepos) {
          try {
            await sendToQueue(channel.id, channel.userId, repoData);
            totalProcessed++;
          } catch (error: any) {
            console.error(formatErrorForLogging(error, { channelId: channel.id, repoFullName: repoData.full_name }));
            throw error;
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
