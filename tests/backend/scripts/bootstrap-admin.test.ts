/**
 * Tests for Admin Bootstrap Script
 * Validates the creation and idempotency of the first admin user
 */

import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminSetUserPasswordCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Pool } from 'pg';
import { UserRepository } from '../../../src/backend/repositories/UserRepository';
import { Visibility } from '@aws-community-hub/shared';

// Mock dependencies
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
    const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
    return {
        ...actual,
        CognitoIdentityProviderClient: jest.fn(),
    };
});
jest.mock('pg');
jest.mock('../../../src/backend/repositories/UserRepository');

const loadScript = () => require('../../../src/backend/scripts/bootstrap-admin');

const defaultArgs = {
    email: 'admin@example.com',
    username: 'admin',
    password: 'SecurePassword123!',
};

describe('Admin Bootstrap Script', () => {
    let mockCognitoClient: jest.Mocked<CognitoIdentityProviderClient>;
    let mockPool: jest.Mocked<Pool>;
    let mockUserRepo: jest.Mocked<UserRepository>;
    let originalEnv: NodeJS.ProcessEnv;
    let originalArgv: string[];
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let processExitSpy: jest.SpyInstance;

    const defaultDeps = () => ({
        pool: mockPool as any,
        userRepository: mockUserRepo as any,
        cognitoClient: mockCognitoClient as any,
    });

    beforeEach(() => {
        jest.resetModules();
        // Save original environment
        originalEnv = { ...process.env };
        originalArgv = [...process.argv];

        // Set up environment variables
        process.env.DATABASE_URL = 'postgresql://test@localhost:5432/test';
        process.env.AWS_REGION = 'us-east-1';
        process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
        process.env.COGNITO_CLIENT_ID = 'testclient';

        // Mock console and process
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
            throw new Error(`Process exited with code ${code}`);
        });

        // Set up mocks
        mockCognitoClient = {
            send: jest.fn()
        } as any;

        mockPool = {
            end: jest.fn()
        } as any;

        mockUserRepo = {
            findByEmail: jest.fn(),
            promoteToAdmin: jest.fn(),
            createUser: jest.fn()
        } as any;

        // Mock constructor calls
        (CognitoIdentityProviderClient as jest.Mock).mockImplementation(() => mockCognitoClient);
        (Pool as jest.Mock).mockImplementation(() => mockPool);
        (UserRepository as jest.Mock).mockImplementation(() => mockUserRepo);
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
        process.argv = originalArgv;

        // Restore console and process
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        processExitSpy.mockRestore();

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('Command Line Arguments', () => {
        test('should reject when email is missing', () => {
            process.argv = ['node', 'script', '--username', 'admin', '--password', 'SecurePass123!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject when username is missing', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--password', 'SecurePass123!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject when password is missing', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject password shorter than 12 characters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'Short1!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must be at least 12 characters long'
            );
        });

        test('should reject password without lowercase letters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'UPPERCASE123!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without uppercase letters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'lowercase123!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without numbers', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'NoNumbersHere!'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without special characters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'NoSpecialChar123'];

            const script = loadScript();

            expect(() => script.parseArgs()).toThrow('INVALID_ARGUMENTS');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should accept valid arguments', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'ValidPassword123!'];

            const { parseArgs } = loadScript();
            const result = parseArgs();

            expect(result).toEqual({
                email: 'admin@example.com',
                username: 'admin',
                password: 'ValidPassword123!'
    });
  });

  describe('runCli', () => {
    it('exits the process when bootstrap fails', async () => {
      const script = loadScript();
      const failingExecutor = jest.fn().mockRejectedValue(new Error('boom'));
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

      await script.runCli(failingExecutor);

      expect(failingExecutor).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('does not exit when bootstrap succeeds', async () => {
      const script = loadScript();
      const executor = jest.fn().mockResolvedValue(undefined);
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

      await script.runCli(executor);

      expect(executor).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });
});

    describe('Environment Variables', () => {
        test('should fail when COGNITO_USER_POOL_ID is missing', () => {
            delete process.env.COGNITO_USER_POOL_ID;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            const { validateEnvironment } = loadScript();

            expect(() => validateEnvironment()).toThrow('INVALID_ENVIRONMENT');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID'
            );
        });

        test('should fail when COGNITO_CLIENT_ID is missing', () => {
            delete process.env.COGNITO_CLIENT_ID;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            const { validateEnvironment } = loadScript();

            expect(() => validateEnvironment()).toThrow('INVALID_ENVIRONMENT');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID'
            );
        });

        test('should derive DATABASE_URL from connection parts when not provided', () => {
            delete process.env.DATABASE_URL;
            process.env.DB_HOST = 'localhost';
            process.env.DB_PORT = '5432';
            process.env.DB_NAME = 'contenthub';
            process.env.DB_USER = 'contentuser';
            process.env.DB_PASSWORD = 'secret';
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            const { validateEnvironment } = loadScript();
            const env = validateEnvironment();

            expect(env.databaseUrl).toBe('postgresql://contentuser:secret@localhost:5432/contenthub');
        });

        test('should encode database password when assembled from individual parts', () => {
            delete process.env.DATABASE_URL;
            process.env.DB_HOST = 'db.aws.local';
            process.env.DB_PORT = '5544';
            process.env.DB_NAME = 'contenthub';
            process.env.DB_USER = 'content.user';
            process.env.DB_PASSWORD = 'S3cret!@#';
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            const { validateEnvironment } = loadScript();
            const env = validateEnvironment();

            expect(env.databaseUrl).toBe('postgresql://content.user:S3cret!%40%23@db.aws.local:5544/contenthub');
        });

        test('should fail when database configuration is missing', () => {
            delete process.env.DATABASE_URL;
            delete process.env.DB_HOST;
            delete process.env.DB_PORT;
            delete process.env.DB_NAME;
            delete process.env.DB_USER;
            delete process.env.DB_PASSWORD;

            const { validateEnvironment } = loadScript();

            expect(() => validateEnvironment()).toThrow(/Invalid environment: DATABASE_URL is required/);
        });

        test('should use default AWS_REGION when not provided', () => {
            delete process.env.AWS_REGION;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            const { validateEnvironment } = loadScript();
            const env = validateEnvironment();

            expect(env.region).toBe('us-east-1');
        });
    });

    describe('Admin Creation Flow', () => {
        const validArgs = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePassword123!'];

        beforeEach(() => {
            process.argv = validArgs;
        });

        test('should instantiate default dependencies when overrides are omitted', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send
                .mockResolvedValueOnce({ User: { Username: 'generated-admin' } })
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(undefined, { cognitoClient: mockCognitoClient as any });

            expect(mockCognitoClient.send).toHaveBeenCalledTimes(3);
        });

        test('should fall back to email when Cognito response lacks username', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({ cognitoSub: defaultArgs.email })
            );
        });

        test('should swallow UserNotFoundException when ensuring admin group', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            const usernameExistsError = new Error('exists');
            (usernameExistsError as any).name = 'UsernameExistsException';
            const userNotFoundError = new Error('missing user');
            (userNotFoundError as any).name = 'UserNotFoundException';

            mockCognitoClient.send
                .mockRejectedValueOnce(usernameExistsError)
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(userNotFoundError);

            const { bootstrapAdmin } = loadScript();
            await expect(bootstrapAdmin(defaultArgs, defaultDeps())).resolves.toBeUndefined();

            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({ email: defaultArgs.email })
            );
        });

        test('should create new admin user successfully', async () => {
            // User doesn't exist in database
            mockUserRepo.findByEmail.mockResolvedValue(null);

            // Cognito operations succeed
            mockCognitoClient.send.mockImplementation((command) => {
                if (command?.constructor?.name === 'AdminCreateUserCommand') {
                    return Promise.resolve({ User: { Username: 'cognito-sub-123' } });
                }
                return Promise.resolve({});
            });

            // Database creation succeeds
            mockUserRepo.createUser.mockResolvedValue({
                id: 'user-id-123',
                email: 'admin@example.com',
                username: 'admin',
                profileSlug: 'admin',
                isAdmin: true,
                isAwsEmployee: false
            });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            expect(mockCognitoClient.send).toHaveBeenCalledTimes(3);

            const createCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminCreateUserCommand'
            )?.[0];
            const passwordCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminSetUserPasswordCommand'
            )?.[0];
            const groupCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminAddUserToGroupCommand'
            )?.[0];

            expect(createCommand?.input?.UserAttributes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ Name: 'email', Value: 'admin@example.com' }),
                    expect.objectContaining({ Name: 'email_verified', Value: 'true' }),
                    expect.objectContaining({ Name: 'custom:username', Value: 'admin' }),
                    expect.objectContaining({ Name: 'custom:is_admin', Value: 'true' }),
                ])
            );
            expect(createCommand?.input?.MessageAction).toBe('SUPPRESS');

            expect(passwordCommand?.input).toMatchObject({
                Username: 'admin@example.com',
                Permanent: true,
            });

            expect(groupCommand?.input).toMatchObject({
                GroupName: 'admin',
                Username: 'admin@example.com',
            });

            // Verify database user creation
            expect(mockUserRepo.createUser).toHaveBeenCalledWith({
                cognitoSub: 'cognito-sub-123',
                email: 'admin@example.com',
                username: 'admin',
                profileSlug: 'admin',
                defaultVisibility: 'public',
                isAdmin: true,
                isAwsEmployee: false
            });

            // Verify success message
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Admin bootstrap completed successfully.')
            );
        });

        test('should be idempotent when admin already exists', async () => {
            // Admin user already exists in database
            mockUserRepo.findByEmail.mockResolvedValue({
                id: 'existing-id',
                email: 'admin@example.com',
                username: 'admin',
                isAdmin: true
            });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            // Should not create user in Cognito
            expect(mockCognitoClient.send).not.toHaveBeenCalled();

            // Should not create user in database
            expect(mockUserRepo.createUser).not.toHaveBeenCalled();

            // Should log idempotent message
            expect(consoleLogSpy).toHaveBeenCalledWith(
                'Admin user already exists. Script is idempotent, no action needed.'
            );
        });

        test('should promote existing non-admin user to admin', async () => {
            // User exists but is not admin
            mockUserRepo.findByEmail.mockResolvedValue({
                id: 'existing-id',
                email: 'admin@example.com',
                username: 'admin',
                isAdmin: false
            });

            mockUserRepo.promoteToAdmin.mockResolvedValue({
                id: 'existing-id',
                email: 'admin@example.com',
                username: 'admin',
                isAdmin: true
            });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            // Should promote to admin
            expect(mockUserRepo.promoteToAdmin).toHaveBeenCalledWith('existing-id');

            // Should log promotion message
            expect(consoleLogSpy).toHaveBeenCalledWith(
                'User promoted to admin successfully.'
            );
        });

        test('should handle Cognito UsernameExistsException gracefully', async () => {
            // User doesn't exist in database
            mockUserRepo.findByEmail.mockResolvedValue(null);

            // Cognito user already exists
            mockCognitoClient.send.mockImplementation((command) => {
                if (command?.constructor?.name === 'AdminCreateUserCommand') {
                    const error = new Error('User already exists');
                    error.name = 'UsernameExistsException';
                    return Promise.reject(error);
                }
                return Promise.resolve({});
            });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            // Should update user attributes
            const attributeCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminUpdateUserAttributesCommand'
            )?.[0];
            expect(attributeCommand?.input?.UserAttributes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ Name: 'custom:is_admin', Value: 'true' })
                ])
            );

            const groupCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminAddUserToGroupCommand'
            )?.[0];
            expect(groupCommand?.input?.GroupName).toBe('admin');
        });

        test('should detect AWS employee from email domain @amazon.com', async () => {
            process.argv = ['node', 'script', '--email', 'admin@amazon.com', '--username', 'admin', '--password', 'SecurePassword123!'];

            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin({
                email: 'admin@amazon.com',
                username: 'admin',
                password: 'SecurePassword123!'
            }, defaultDeps());

            // Should set isAwsEmployee to true
            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    isAwsEmployee: true
                })
            );
        });

        test('should detect AWS employee from email domain @aws.com', async () => {
            process.argv = ['node', 'script', '--email', 'admin@aws.com', '--username', 'admin', '--password', 'SecurePassword123!'];

            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin({
                email: 'admin@aws.com',
                username: 'admin',
                password: 'SecurePassword123!'
            }, defaultDeps());

            // Should set isAwsEmployee to true
            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    isAwsEmployee: true
                })
            );
        });

        test('should handle general errors gracefully', async () => {
            mockUserRepo.findByEmail.mockRejectedValue(new Error('Database connection failed'));

            const { bootstrapAdmin } = loadScript();

            await expect(bootstrapAdmin(defaultArgs, defaultDeps())).rejects.toThrow('Database connection failed');

            // Should log error
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Bootstrap failed:',
                expect.any(Error)
            );

            // Should close database connection
            expect(mockPool.end).toHaveBeenCalled();
        });

        test('should suppress welcome email when creating Cognito user', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            const createCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminCreateUserCommand'
            )?.[0];

            expect(createCommand?.input?.MessageAction).toBe('SUPPRESS');
        });

        test('should set email_verified to true', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin(defaultArgs, defaultDeps());

            const createCommand = mockCognitoClient.send.mock.calls.find(
                ([command]) => command?.constructor?.name === 'AdminCreateUserCommand'
            )?.[0];

            const emailVerifiedAttr = createCommand?.input?.UserAttributes?.find(
                (attr: any) => attr.Name === 'email_verified'
            );

            expect(emailVerifiedAttr?.Value).toBe('true');
        });

        test('should generate proper profile slug', async () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'Admin-User_123', '--password', 'SecurePassword123!'];

            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const { bootstrapAdmin } = loadScript();
            await bootstrapAdmin({
                email: 'admin@example.com',
                username: 'Admin-User_123',
                password: 'SecurePassword123!'
            }, defaultDeps());

            // Should generate slug from username
            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    profileSlug: 'admin-user-123'
                })
            );
        });
    });

    describe('Error Handling', () => {
        test('should exit with code 1 on fatal errors', async () => {
            mockUserRepo.findByEmail.mockRejectedValue(new Error('Fatal database error'));

            const { bootstrapAdmin } = loadScript();

            await expect(bootstrapAdmin(defaultArgs, defaultDeps())).rejects.toThrow('Fatal database error');

            expect(consoleErrorSpy).toHaveBeenCalledWith('Bootstrap failed:', expect.any(Error));
        });

        test('should always close database pool even on error', async () => {
            mockUserRepo.findByEmail.mockRejectedValue(new Error('Some error'));

            const { bootstrapAdmin } = loadScript();

            await expect(bootstrapAdmin(defaultArgs, defaultDeps())).rejects.toThrow('Some error');

            // Pool should be closed
            expect(mockPool.end).toHaveBeenCalled();
        });
    });
});
