import { getClientEnvironment, resetClientEnvironmentCache } from '@/config/environment';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    resetClientEnvironmentCache();
  });

  afterAll(() => {
    process.env = originalEnv;
    resetClientEnvironmentCache();
  });

  describe('getClientEnvironment', () => {
    describe('valid configurations', () => {
      it('should return valid configuration with all required fields', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_ABC123';
        process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client123';
        process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
        expect(config.NEXT_PUBLIC_COGNITO_USER_POOL_ID).toBe('us-east-1_ABC123');
        expect(config.NEXT_PUBLIC_COGNITO_CLIENT_ID).toBe('client123');
        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('us-east-1');
      });

      it('should strip trailing slash from API URL', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });

      it('should handle API URL without trailing slash', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });

      it('should use default AWS region when not provided', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        delete process.env.NEXT_PUBLIC_AWS_REGION;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('us-east-1');
      });

      it('should handle optional Cognito fields as undefined', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
        delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_COGNITO_USER_POOL_ID).toBeUndefined();
        expect(config.NEXT_PUBLIC_COGNITO_CLIENT_ID).toBeUndefined();
      });

      it('should use localhost API URL in test environment when missing', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.NEXT_PUBLIC_API_URL;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should use localhost API URL in test environment when empty', () => {
        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = '';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });

      it('should use localhost API URL in test environment when whitespace', () => {
        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = '   ';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      });
    });

    describe('invalid configurations', () => {
      it('should throw error when API URL is missing in non-test environment', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.NEXT_PUBLIC_API_URL;

        expect(() => getClientEnvironment()).toThrow(
          'Invalid client environment configuration'
        );
      });

      it('should throw error when API URL is not a valid URL', () => {
        process.env.NEXT_PUBLIC_API_URL = 'not-a-url';

        expect(() => getClientEnvironment()).toThrow(
          'Invalid client environment configuration'
        );
      });

      it('should throw error when API URL is empty in non-test environment', () => {
        process.env.NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_API_URL = '';

        expect(() => getClientEnvironment()).toThrow(
          'Invalid client environment configuration'
        );
      });

      it('should include validation error details in error message', () => {
        process.env.NEXT_PUBLIC_API_URL = 'invalid-url';

        expect(() => getClientEnvironment()).toThrow(/NEXT_PUBLIC_API_URL must be a valid URL/);
      });
    });

    describe('caching behavior', () => {
      it('should cache environment configuration on server side', () => {
        // Simulate server-side (Node.js environment)
        Object.defineProperty(global, 'window', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        process.env.NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config1 = getClientEnvironment();
        process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';
        const config2 = getClientEnvironment();

        // Should return cached value
        expect(config1.NEXT_PUBLIC_API_URL).toBe(config2.NEXT_PUBLIC_API_URL);
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');

        // Restore window for other tests
        Object.defineProperty(global, 'window', {
          value: {},
          writable: true,
          configurable: true,
        });
      });

      it('should not cache in test environment on server side', () => {
        // Simulate server-side (Node.js environment)
        Object.defineProperty(global, 'window', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        process.env.NODE_ENV = 'test';
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config1 = getClientEnvironment();

        resetClientEnvironmentCache();
        process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';

        const config2 = getClientEnvironment();

        // Should use new value in test mode after reset
        expect(config1.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api2.example.com');

        // Restore window for other tests
        Object.defineProperty(global, 'window', {
          value: {},
          writable: true,
          configurable: true,
        });
      });

      it('should cache environment configuration on client side', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config1 = getClientEnvironment();
        process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';
        const config2 = getClientEnvironment();

        // Should return cached value
        expect(config1.NEXT_PUBLIC_API_URL).toBe(config2.NEXT_PUBLIC_API_URL);
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      });
    });

    describe('resetClientEnvironmentCache', () => {
      it('should clear the cache', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

        const config1 = getClientEnvironment();
        expect(config1.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');

        resetClientEnvironmentCache();
        process.env.NEXT_PUBLIC_API_URL = 'https://api2.example.com';

        const config2 = getClientEnvironment();
        expect(config2.NEXT_PUBLIC_API_URL).toBe('https://api2.example.com');
      });
    });

    describe('all exports', () => {
      it('should export getClientEnvironment function', () => {
        expect(typeof getClientEnvironment).toBe('function');
      });

      it('should export resetClientEnvironmentCache function', () => {
        expect(typeof resetClientEnvironmentCache).toBe('function');
      });
    });

    describe('edge cases', () => {
      it('should handle URL with multiple trailing slashes', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com///';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe('https://api.example.com//');
      });

      it('should handle custom AWS regions', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
        process.env.NEXT_PUBLIC_AWS_REGION = 'eu-west-1';

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_AWS_REGION).toBe('eu-west-1');
      });

      it('should handle very long valid URLs', () => {
        const longUrl = `https://api.example.com/${'a'.repeat(500)}`;
        process.env.NEXT_PUBLIC_API_URL = longUrl;

        const config = getClientEnvironment();

        expect(config.NEXT_PUBLIC_API_URL).toBe(longUrl);
      });
    });
  });
});
