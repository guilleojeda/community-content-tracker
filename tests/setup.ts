import '@testing-library/jest-dom';
import { clearRateLimiterStore } from '../src/backend/services/rateLimiter';
// import 'jest-extended';
// import { jest } from '@jest/globals';

// Set up test environment
(process.env as any).NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.CDK_DEFAULT_REGION = 'us-east-1';
process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
// Mock DATABASE_URL for tests that don't use real database
process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/test_db';
process.env.BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v1';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.CORS_ALLOW_HEADERS = process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type';
process.env.CORS_ALLOW_METHODS = process.env.CORS_ALLOW_METHODS || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
process.env.CORS_MAX_AGE = process.env.CORS_MAX_AGE || '600';
process.env.CORS_CREDENTIALS = process.env.CORS_CREDENTIALS || 'true';
process.env.DATABASE_POOL_MIN = process.env.DATABASE_POOL_MIN || '1';
process.env.DATABASE_POOL_MAX = process.env.DATABASE_POOL_MAX || '5';
process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || '30000';
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || '60000';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = process.env.AUTH_RATE_LIMIT_PER_MINUTE || '1000';
process.env.RATE_LIMIT_ANONYMOUS = process.env.RATE_LIMIT_ANONYMOUS || '100';
process.env.RATE_LIMIT_AUTHENTICATED = process.env.RATE_LIMIT_AUTHENTICATED || '1000';
process.env.RATE_LIMIT_WINDOW_MINUTES = process.env.RATE_LIMIT_WINDOW_MINUTES || '1';
process.env.STATS_CACHE_TTL = process.env.STATS_CACHE_TTL || '60';
process.env.ANALYTICS_RETENTION_DAYS = process.env.ANALYTICS_RETENTION_DAYS || '730';
process.env.TOKEN_VERIFICATION_TIMEOUT_MS = process.env.TOKEN_VERIFICATION_TIMEOUT_MS || '3000';
process.env.MFA_TOTP_SEED = process.env.MFA_TOTP_SEED || 'TESTMFASEED123456';
process.env.ENABLE_BETA_FEATURES = process.env.ENABLE_BETA_FEATURES || 'false';
process.env.ENABLE_SOFT_DELETE = process.env.ENABLE_SOFT_DELETE || 'true';
process.env.SYNTHETIC_URL = process.env.SYNTHETIC_URL || 'http://localhost:3000';
process.env.MONITORING_ERROR_RATE_THRESHOLD = process.env.MONITORING_ERROR_RATE_THRESHOLD || '0.01';
process.env.MONITORING_P99_LATENCY_MS = process.env.MONITORING_P99_LATENCY_MS || '1000';
process.env.MONITORING_DB_CONNECTION_THRESHOLD = process.env.MONITORING_DB_CONNECTION_THRESHOLD || '70';
process.env.MONITORING_DLQ_THRESHOLD = process.env.MONITORING_DLQ_THRESHOLD || '1';
process.env.MONITORING_DAILY_COST_THRESHOLD = process.env.MONITORING_DAILY_COST_THRESHOLD || '500';
process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD =
  process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD || '99';
process.env.MONITORING_BILLING_REGION = process.env.MONITORING_BILLING_REGION || 'us-east-1';
process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'test-youtube-key';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
process.env.DATABASE_NAME = process.env.DATABASE_NAME || 'community_content';
process.env.VPC_NAT_GATEWAYS = process.env.VPC_NAT_GATEWAYS || '1';
process.env.API_GW_THROTTLE_RATE_LIMIT = process.env.API_GW_THROTTLE_RATE_LIMIT || '100';
process.env.API_GW_THROTTLE_BURST_LIMIT = process.env.API_GW_THROTTLE_BURST_LIMIT || '200';
process.env.API_GW_DATA_TRACE_ENABLED = process.env.API_GW_DATA_TRACE_ENABLED || 'true';
process.env.COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1';
process.env.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'test-user-pool';
process.env.COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || 'test-client-id';
process.env.COGNITO_CALLBACK_URLS = process.env.COGNITO_CALLBACK_URLS || 'http://localhost:3000/callback';
process.env.COGNITO_LOGOUT_URLS = process.env.COGNITO_LOGOUT_URLS || 'http://localhost:3000/logout';
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
process.env.NEXT_PUBLIC_AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
process.env.NEXT_PUBLIC_ENVIRONMENT = process.env.NEXT_PUBLIC_ENVIRONMENT || 'development';
process.env.NEXT_PUBLIC_FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_URL || 'https://awscommunityhub.org/beta-feedback';
process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES || 'false';
process.env.ENVIRONMENT = process.env.ENVIRONMENT || 'test';

// Mock AWS SDK to prevent actual AWS calls and async cleanup issues
// jest.mock('@aws-sdk/client-s3');
// jest.mock('@aws-sdk/client-cloudformation');
// jest.mock('@aws-sdk/client-rds');
// jest.mock('@aws-sdk/client-ec2');

// Global test timeout
// jest.setTimeout(30000);

// Mock console methods for cleaner test output
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.debug = () => {};
  }
});

afterAll(() => {
  // Restore console
  Object.assign(console, originalConsole);
});

// Global test helpers
global.testHelpers = {
  // Create mock CDK app
  createMockApp: () => ({
    node: {
      tryGetContext: () => undefined,
    },
    synth: () => undefined,
  }),

  // Create mock CDK stack
  createMockStack: (app: any, id: string) => ({
    stackName: id,
    node: {
      id,
      children: [],
    },
    account: '123456789012',
    region: 'us-east-1',
    addTransform: jest.fn(),
    formatArn: jest.fn(),
    splitArn: jest.fn(),
    resolve: jest.fn((value) => value),
    toJsonString: jest.fn(),
    exportValue: jest.fn(),
  }),

  // Mock AWS resource responses
  mockAWSResponses: {
    s3: {
      createBucket: { Location: 'http://test-bucket.s3.amazonaws.com/' },
      listObjects: { Contents: [] },
      putBucketWebsite: {},
    },
    cloudformation: {
      describeStacks: {
        Stacks: [{
          StackName: 'test-stack',
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [],
        }],
      },
    },
    rds: {
      createDBCluster: {
        DBCluster: {
          DBClusterIdentifier: 'test-cluster',
          Status: 'available',
        },
      },
    },
  },
};

// Extend Jest matchers
expect.extend({
  toBeValidCDKConstruct(received) {
    const pass = received && typeof received.node === 'object';
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid CDK construct`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid CDK construct with node property`,
        pass: false,
      };
    }
  },

  toHaveValidStackProps(received) {
    const requiredProps = ['stackName', 'account', 'region'];
    const pass = requiredProps.every(prop => received.hasOwnProperty(prop));
    
    if (pass) {
      return {
        message: () => `expected stack not to have valid props`,
        pass: true,
      };
    } else {
      const missing = requiredProps.filter(prop => !received.hasOwnProperty(prop));
      return {
        message: () => `expected stack to have props: ${missing.join(', ')}`,
        pass: false,
      };
    }
  },
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  clearRateLimiterStore();
});

// Database test helpers for integration tests
export const dbTestHelpers = {
  async withTransaction<T>(callback: () => Promise<T>): Promise<T> {
    // Mock transaction wrapper for tests
    try {
      return await callback();
    } catch (error) {
      // Mock rollback
      throw error;
    }
  },

  createTestDatabase: jest.fn().mockResolvedValue({
    query: jest.fn(),
    close: jest.fn(),
  }),

  seedTestData: jest.fn().mockResolvedValue(undefined),
  
  cleanupTestData: jest.fn().mockResolvedValue(undefined),
};

// CI/CD test helpers
export const ciTestHelpers = {
  mockGitHubActions: {
    setOutput: jest.fn(),
    setFailed: jest.fn(),
    getInput: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },

  mockWorkflowContext: {
    payload: {
      pull_request: {
        number: 123,
        head: { sha: 'abc123' },
        base: { ref: 'main' },
      },
    },
    repo: {
      owner: 'test-org',
      repo: 'test-repo',
    },
  },
};

// Export types for TypeScript
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidCDKConstruct(): R;
      toHaveValidStackProps(): R;
    }
  }

  var testHelpers: {
    createMockApp: () => any;
    createMockStack: (app: any, id: string) => any;
    mockAWSResponses: any;
  };
}
