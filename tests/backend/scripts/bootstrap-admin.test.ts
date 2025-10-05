/**
 * Tests for Admin Bootstrap Script
 * Validates the creation and idempotency of the first admin user
 */

import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminSetUserPasswordCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Pool } from 'pg';
import { UserRepository } from '../../../src/backend/repositories/UserRepository';
import { Visibility } from '@aws-community-hub/shared';

// Mock dependencies
jest.mock('@aws-sdk/client-cognito-identity-provider');
jest.mock('pg');
jest.mock('../../../src/backend/repositories/UserRepository');

describe('Admin Bootstrap Script', () => {
    let mockCognitoClient: jest.Mocked<CognitoIdentityProviderClient>;
    let mockPool: jest.Mocked<Pool>;
    let mockUserRepo: jest.Mocked<UserRepository>;
    let originalEnv: NodeJS.ProcessEnv;
    let originalArgv: string[];
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let processExitSpy: jest.SpyInstance;

    beforeEach(() => {
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

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject when username is missing', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--password', 'SecurePass123!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject when password is missing', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Usage: npm run bootstrap:admin')
            );
        });

        test('should reject password shorter than 12 characters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'Short1!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must be at least 12 characters long'
            );
        });

        test('should reject password without lowercase letters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'UPPERCASE123!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without uppercase letters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'lowercase123!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without numbers', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'NoNumbersHere!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should reject password without special characters', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'NoSpecialChar123'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Password must contain lowercase, uppercase, numbers, and special characters'
            );
        });

        test('should accept valid arguments', () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'ValidPassword123!'];

            // This should not throw an error for argument parsing
            // (It may throw later for other reasons, but not for args)
            const parseArgs = require('../../../src/backend/scripts/bootstrap-admin').parseArgs;
            const result = parseArgs();

            expect(result).toEqual({
                email: 'admin@example.com',
                username: 'admin',
                password: 'ValidPassword123!'
            });
        });
    });

    describe('Environment Variables', () => {
        test('should fail when COGNITO_USER_POOL_ID is missing', () => {
            delete process.env.COGNITO_USER_POOL_ID;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID'
            );
        });

        test('should fail when COGNITO_CLIENT_ID is missing', () => {
            delete process.env.COGNITO_CLIENT_ID;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            expect(() => {
                require('../../../src/backend/scripts/bootstrap-admin');
            }).toThrow('Process exited with code 1');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID'
            );
        });

        test('should use default DATABASE_URL when not provided', () => {
            delete process.env.DATABASE_URL;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            // Mock successful execution
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({
                User: { Username: 'test-sub' }
            });
            mockUserRepo.createUser.mockResolvedValue({
                id: 'test-id',
                email: 'admin@example.com',
                username: 'admin',
                isAdmin: true
            });

            // Should use default connection string
            expect(Pool).toHaveBeenCalledWith({
                connectionString: 'postgresql://postgres:postgres@localhost:5432/content_hub_dev'
            });
        });

        test('should use default AWS_REGION when not provided', () => {
            delete process.env.AWS_REGION;
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePass123!'];

            // Should use default region
            expect(CognitoIdentityProviderClient).toHaveBeenCalledWith({
                region: 'us-east-1'
            });
        });
    });

    describe('Admin Creation Flow', () => {
        const validArgs = ['node', 'script', '--email', 'admin@example.com', '--username', 'admin', '--password', 'SecurePassword123!'];

        beforeEach(() => {
            process.argv = validArgs;
        });

        test('should create new admin user successfully', async () => {
            // User doesn't exist in database
            mockUserRepo.findByEmail.mockResolvedValue(null);

            // Cognito operations succeed
            mockCognitoClient.send.mockImplementation((command) => {
                if (command instanceof AdminCreateUserCommand) {
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

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Verify Cognito user creation
            expect(mockCognitoClient.send).toHaveBeenCalledWith(
                expect.any(AdminCreateUserCommand)
            );

            // Verify password setting
            expect(mockCognitoClient.send).toHaveBeenCalledWith(
                expect.any(AdminSetUserPasswordCommand)
            );

            // Verify admin group addition
            expect(mockCognitoClient.send).toHaveBeenCalledWith(
                expect.any(AdminAddUserToGroupCommand)
            );

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
                expect.stringContaining('Admin bootstrap completed successfully!')
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

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Should not create user in Cognito
            expect(mockCognitoClient.send).not.toHaveBeenCalled();

            // Should not create user in database
            expect(mockUserRepo.createUser).not.toHaveBeenCalled();

            // Should log idempotent message
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '✅ Admin user already exists. Script is idempotent, no action needed.'
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

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Should promote to admin
            expect(mockUserRepo.promoteToAdmin).toHaveBeenCalledWith('existing-id');

            // Should log promotion message
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '✅ User promoted to admin successfully.'
            );
        });

        test('should handle Cognito UsernameExistsException gracefully', async () => {
            // User doesn't exist in database
            mockUserRepo.findByEmail.mockResolvedValue(null);

            // Cognito user already exists
            mockCognitoClient.send.mockImplementation((command) => {
                if (command instanceof AdminCreateUserCommand) {
                    const error = new Error('User already exists');
                    error.name = 'UsernameExistsException';
                    return Promise.reject(error);
                }
                return Promise.resolve({});
            });

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Should update user attributes
            expect(mockCognitoClient.send).toHaveBeenCalledWith(
                expect.any(AdminUpdateUserAttributesCommand)
            );

            // Should add to admin group
            expect(mockCognitoClient.send).toHaveBeenCalledWith(
                expect.any(AdminAddUserToGroupCommand)
            );
        });

        test('should detect AWS employee from email domain @amazon.com', async () => {
            process.argv = ['node', 'script', '--email', 'admin@amazon.com', '--username', 'admin', '--password', 'SecurePassword123!'];

            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

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

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Should set isAwsEmployee to true
            expect(mockUserRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    isAwsEmployee: true
                })
            );
        });

        test('should handle general errors gracefully', async () => {
            mockUserRepo.findByEmail.mockRejectedValue(new Error('Database connection failed'));

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;

            await expect(bootstrapAdmin()).rejects.toThrow('Database connection failed');

            // Should log error
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '❌ Bootstrap failed:',
                expect.any(Error)
            );

            // Should close database connection
            expect(mockPool.end).toHaveBeenCalled();
        });

        test('should suppress welcome email when creating Cognito user', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Verify MessageAction is SUPPRESS
            const createUserCall = mockCognitoClient.send.mock.calls.find(
                call => call[0] instanceof AdminCreateUserCommand
            );

            expect(createUserCall[0].input.MessageAction).toBe('SUPPRESS');
        });

        test('should set email_verified to true', async () => {
            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

            // Verify email_verified attribute
            const createUserCall = mockCognitoClient.send.mock.calls.find(
                call => call[0] instanceof AdminCreateUserCommand
            );

            const emailVerifiedAttr = createUserCall[0].input.UserAttributes.find(
                attr => attr.Name === 'email_verified'
            );

            expect(emailVerifiedAttr.Value).toBe('true');
        });

        test('should generate proper profile slug', async () => {
            process.argv = ['node', 'script', '--email', 'admin@example.com', '--username', 'Admin-User_123', '--password', 'SecurePassword123!'];

            mockUserRepo.findByEmail.mockResolvedValue(null);
            mockCognitoClient.send.mockResolvedValue({ User: { Username: 'sub-123' } });

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;
            await bootstrapAdmin();

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

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;

            await expect(bootstrapAdmin()).rejects.toThrow('Fatal database error');

            expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', expect.any(Error));
        });

        test('should always close database pool even on error', async () => {
            mockUserRepo.findByEmail.mockRejectedValue(new Error('Some error'));

            const bootstrapAdmin = require('../../../src/backend/scripts/bootstrap-admin').bootstrapAdmin;

            await expect(bootstrapAdmin()).rejects.toThrow('Some error');

            // Pool should be closed
            expect(mockPool.end).toHaveBeenCalled();
        });
    });
});