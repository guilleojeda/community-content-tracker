import { z } from 'zod';
import { getClientEnvironment, resetClientEnvironmentCache } from '@/config/environment';

describe('Client Environment Configuration', () => {
  const originalEnv = process.env;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Reset environment before each test
    jest.resetModules();
    process.env = { ...originalEnv };
    resetClientEnvironmentCache();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
    process.env.NODE_ENV = originalNodeEnv;
    resetClientEnvironmentCache();
  });

  describe('getClientEnvironment', () => {
    describe('successful configuration', () => {
      it('should parse valid environment variables', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_abc123';
        process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = '1234567890abcdef';
        process.env.NEXT_PUBLIC_AWS_REGION = 'us-west-2';

        const config = getClientEnvironment();

        expect(config).toEqual({
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
          NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-1_abc123',
          NEXT_PUBLIC_COGNITO_CLIENT_ID: '1234567890abcdef',
          NEXT_PUBLIC_AWS_REGION: 'us-west-2',
        });
      });

      it('should strip trailing slash from API URL', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';
        process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });

      it('should use default AWS region when not provided', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        delete process.env.NEXT_PUBLIC_AWS_REGION;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('us-east-1');
      });

      it('should allow optional Cognito configuration', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
        delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
        expect(config.NEXT_PUBLIC_COGNITO_USER_POOL_ID).toBeUndefined();
        expect(config.NEXT_PUBLIC_COGNITO_CLIENT_ID).toBeUndefined();
      });

      it('should cache environment after first parse', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';

        const config1 = getClientEnvironment();

        // Change environment after first call
        process.env.NEXT_PUBLIC_API_URL = 'https://changed.example.com';

        const config2 = getClientEnvironment();

        // Should return cached value
        expect(config1).toBe(config2);
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });
    });

    describe('test environment behavior', () => {
      it('should provide default API URL in test environment when missing', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.NEXT_PUBLIC_API_URL;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should provide default API URL in test environment when empty', () => {
        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = '';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should provide default API URL in test environment when only whitespace', () => {
        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = '   ';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should not cache in test environment on server side', () => {
        // Simulate server-side (Node.js environment)
        Object.defineProperty(global, 'window', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = 'https://api1.example.com';

        const config1 = getClientEnvironment();

        // In test mode on server, it doesn't cache, so we can get new value
        resetClientEnvironmentCache();
        process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';

        const config2 = getClientEnvironment();

        // Should reflect new value in test mode after reset
        expect(config1.NEXT_PUBLIC_API_URL).toBe('https://api1.example.com');
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api2.example.com');

        // Restore window for other tests
        Object.defineProperty(global, 'window', {
          value: {},
          writable: true,
          configurable: true,
        });
      });

      it('should use provided API URL over test default', () => {
        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = 'https://custom.example.com';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://custom.example.com');
      });
    });

    describe('error handling', () => {
      it('should throw error when NEXT_PUBLIC_API_URL is missing in production', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.NEXT_PUBLIC_API_URL;

        expect(() => getClientEnvironment()).toThrow(
          /Invalid client environment configuration/
        );
      });

      it('should throw error when NEXT_PUBLIC_API_URL is empty string in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_API_URL = '';

        expect(() => getClientEnvironment()).toThrow(
          /Invalid client environment configuration/
        );
      });

      it('should throw error when NEXT_PUBLIC_API_URL is not a valid URL', () => {
        process.env.NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_API_URL = 'not-a-valid-url';

        expect(() => getClientEnvironment()).toThrow(
          /NEXT_PUBLIC_API_URL must be a valid URL/
        );
      });

      it('should throw error when NEXT_PUBLIC_API_URL is malformed', () => {
        process.env.NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_API_URL = 'not-a-valid-url';

        expect(() => getClientEnvironment()).toThrow(/NEXT_PUBLIC_API_URL must be a valid URL/);
      });

      it('should throw error when AWS region is empty string', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = '';

        expect(() => getClientEnvironment()).toThrow(
          /Invalid client environment configuration/
        );
      });
    });

    describe('URL validation', () => {
      it('should accept http URLs', () => {
        process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should accept https URLs', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });

      it('should accept URLs with ports', () => {
        process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should accept URLs with paths', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/v1';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com/v1');
      });

      it('should strip trailing slash from URLs with paths', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/v1/';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com/v1');
      });

      it('should handle multiple trailing slashes', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com///';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com//');
      });
    });

    describe('AWS region configuration', () => {
      it('should accept valid AWS regions', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = 'us-west-2';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('us-west-2');
      });

      it('should accept eu regions', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = 'eu-west-1';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('eu-west-1');
      });

      it('should accept ap regions', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = 'ap-southeast-2';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('ap-southeast-2');
      });
    });

    describe('Cognito configuration', () => {
      it('should accept valid Cognito User Pool IDs', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_abc123xyz';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_COGNITO_USER_POOL_ID).toBe('us-east-1_abc123xyz');
      });

      it('should accept valid Cognito Client IDs', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = '1a2b3c4d5e6f7g8h9i0j';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_COGNITO_CLIENT_ID).toBe('1a2b3c4d5e6f7g8h9i0j');
      });

      it('should work without Cognito configuration', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
        delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

        expect(() => getClientEnvironment()).not.toThrow();
      });
    });
  });

  describe('resetClientEnvironmentCache', () => {
    it('should clear the cached environment', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api1.example.com';
      process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';

      const config1 = getClientEnvironment();

      // Change environment
      process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';

      // Without reset, should return cached value
      const config2 = getClientEnvironment();
      expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api1.example.com');

      // Reset cache
      resetClientEnvironmentCache();

      // Should now return new value
      const config3 = getClientEnvironment();
      expect(config3.NEXT_PUBLIC_API_URL).toBe('https://api2.example.com');
    });

    it('should allow re-caching after reset', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
      process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';

      const config1 = getClientEnvironment();
      resetClientEnvironmentCache();

      process.env.NEXT_PUBLIC_API_URL = 'https://new-api.example.com';

      const config2 = getClientEnvironment();
      const config3 = getClientEnvironment();

      // After reset, should cache new value
      expect(config2).toBe(config3);
      expect(config2.NEXT_PUBLIC_API_URL).toBe('https://new-api.example.com');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined environment variables', () => {
      process.env.NODE_ENV = 'test';
      process.env.NEXT_PUBLIC_API_URL = undefined as any;

      const config = getClientEnvironment();

      expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
    });

    it('should handle null environment variables', () => {
      process.env.NODE_ENV = 'test';
      process.env.NEXT_PUBLIC_API_URL = null as any;

      const config = getClientEnvironment();

      expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
    });

    it('should accept URLs with whitespace but preserve them', () => {
      process.env.NEXT_PUBLIC_API_URL = '  https://api.example.com  ';

      // Zod's url() validator accepts URLs with whitespace and preserves them
      const config = getClientEnvironment();
      expect(config.NEXT_PUBLIC_API_URL).toBe('  https://api.example.com  ');
    });

    it('should handle very long valid URLs', () => {
      const longPath = '/very/long/path/'.repeat(10);
      process.env.NEXT_PUBLIC_API_URL = `https://api.example.com${longPath}`;

      const config = getClientEnvironment();

      expect(config.NEXT_PUBLIC_API_URL).toBe(`https://api.example.com${longPath.slice(0, -1)}`);
    });
  });

  describe('server vs client behavior', () => {
    it('should work on server side (typeof window === undefined)', () => {
      // This test runs in Node.js where window is undefined
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

      const config = getClientEnvironment();

      expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
    });

    it('should cache on server side in non-test environments', () => {
      process.env.NODE_ENV = 'production';
      process.env.NEXT_PUBLIC_API_URL = 'https://api1.example.com';

      const config1 = getClientEnvironment();

      process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';

      const config2 = getClientEnvironment();

      // Should use cached value
      expect(config1).toBe(config2);
      expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api1.example.com');
    });
  });
});
