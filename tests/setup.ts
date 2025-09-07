import 'jest-extended';
import { jest } from '@jest/globals';

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.CDK_DEFAULT_REGION = 'us-east-1';
process.env.CDK_DEFAULT_ACCOUNT = '123456789012';

// Mock AWS SDK to prevent actual AWS calls
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-cloudformation');
jest.mock('@aws-sdk/client-rds');
jest.mock('@aws-sdk/client-ec2');

// Global test timeout
jest.setTimeout(30000);

// Mock console methods for cleaner test output
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.debug = jest.fn();
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
      tryGetContext: jest.fn(),
    },
    synth: jest.fn(),
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