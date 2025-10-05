#!/usr/bin/env node
/**
 * Admin Bootstrap Script
 * Creates the first admin user for the AWS Community Content Hub
 *
 * Usage:
 *   npm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!
 *
 * Environment Variables:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - AWS_REGION: AWS region for Cognito
 *   - COGNITO_USER_POOL_ID: Cognito User Pool ID
 *   - COGNITO_CLIENT_ID: Cognito App Client ID
 */

import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminSetUserPasswordCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Pool } from 'pg';
import { UserRepository } from '../repositories/UserRepository';
import { Visibility } from '@aws-community-hub/shared';

// Parse command line arguments
function parseArgs(): { email: string; username: string; password: string } {
    const args = process.argv.slice(2);
    const email = getArg(args, '--email');
    const username = getArg(args, '--username');
    const password = getArg(args, '--password');

    if (!email || !username || !password) {
        console.error('Usage: npm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!');
        process.exit(1);
    }

    // Validate password meets requirements
    if (password.length < 12) {
        console.error('Password must be at least 12 characters long');
        process.exit(1);
    }

    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
        console.error('Password must contain lowercase, uppercase, numbers, and special characters');
        process.exit(1);
    }

    return { email, username, password };
}

function getArg(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    return index > -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

// Validate environment variables
function validateEnvironment(): {
    databaseUrl: string;
    region: string;
    userPoolId: string;
    clientId: string;
} {
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/content_hub_dev';
    const region = process.env.AWS_REGION || 'us-east-1';
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;

    if (!userPoolId || !clientId) {
        console.error('Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID');
        console.error('Please set these or run: source .env.development');
        process.exit(1);
    }

    return { databaseUrl, region, userPoolId, clientId };
}

// Main bootstrap function
async function bootstrapAdmin() {
    console.log('🚀 Starting admin bootstrap process...');

    const { email, username, password } = parseArgs();
    const { databaseUrl, region, userPoolId, clientId } = validateEnvironment();

    // Initialize database connection
    const pool = new Pool({ connectionString: databaseUrl });
    const userRepo = new UserRepository(pool);

    // Initialize Cognito client
    const cognitoClient = new CognitoIdentityProviderClient({ region });

    try {
        // Step 1: Check if admin user already exists in database
        console.log('📊 Checking if admin user already exists...');
        const existingUser = await userRepo.findByEmail(email);

        if (existingUser) {
            if (existingUser.isAdmin) {
                console.log('✅ Admin user already exists. Script is idempotent, no action needed.');
                return;
            } else {
                console.log('🔄 User exists but is not admin. Promoting to admin...');
                await userRepo.promoteToAdmin(existingUser.id);
                console.log('✅ User promoted to admin successfully.');
            }
        }

        // Step 2: Create user in Cognito (bypass email verification)
        console.log('🔐 Creating user in Cognito...');

        try {
            const createUserCommand = new AdminCreateUserCommand({
                UserPoolId: userPoolId,
                Username: email,
                UserAttributes: [
                    { Name: 'email', Value: email },
                    { Name: 'email_verified', Value: 'true' },
                    { Name: 'custom:username', Value: username },
                    { Name: 'custom:default_visibility', Value: 'public' },
                    { Name: 'custom:is_admin', Value: 'true' }
                ],
                MessageAction: 'SUPPRESS', // Don't send welcome email
                TemporaryPassword: password
            });

            const createUserResult = await cognitoClient.send(createUserCommand);
            console.log('✅ Cognito user created successfully');

            // Step 3: Set permanent password
            console.log('🔑 Setting permanent password...');
            const setPasswordCommand = new AdminSetUserPasswordCommand({
                UserPoolId: userPoolId,
                Username: email,
                Password: password,
                Permanent: true
            });

            await cognitoClient.send(setPasswordCommand);
            console.log('✅ Password set successfully');

            // Step 4: Add user to admin group
            console.log('👥 Adding user to admin group...');
            const addToGroupCommand = new AdminAddUserToGroupCommand({
                UserPoolId: userPoolId,
                Username: email,
                GroupName: 'admin'
            });

            await cognitoClient.send(addToGroupCommand);
            console.log('✅ User added to admin group');

            // Step 5: Create user in database if not exists
            if (!existingUser) {
                console.log('💾 Creating user in database...');

                const cognitoSub = createUserResult.User?.Username || email;
                const profileSlug = generateSlug(username);

                await userRepo.createUser({
                    cognitoSub,
                    email,
                    username,
                    profileSlug,
                    defaultVisibility: 'public' as Visibility,
                    isAdmin: true,
                    isAwsEmployee: email.endsWith('@amazon.com') || email.endsWith('@aws.com')
                });

                console.log('✅ Database user created successfully');
            }

        } catch (error: any) {
            if (error.name === 'UsernameExistsException') {
                console.log('⚠️  User already exists in Cognito');

                // Update attributes to ensure admin status
                console.log('🔄 Updating user attributes...');
                const updateCommand = new AdminUpdateUserAttributesCommand({
                    UserPoolId: userPoolId,
                    Username: email,
                    UserAttributes: [
                        { Name: 'custom:is_admin', Value: 'true' }
                    ]
                });

                await cognitoClient.send(updateCommand);

                // Add to admin group
                try {
                    const addToGroupCommand = new AdminAddUserToGroupCommand({
                        UserPoolId: userPoolId,
                        Username: email,
                        GroupName: 'admin'
                    });
                    await cognitoClient.send(addToGroupCommand);
                } catch (groupError: any) {
                    if (groupError.name !== 'UserNotFoundException') {
                        // Ignore if already in group
                    }
                }

                console.log('✅ User updated to admin in Cognito');
            } else {
                throw error;
            }
        }

        console.log('');
        console.log('🎉 Admin bootstrap completed successfully!');
        console.log('');
        console.log('Admin credentials:');
        console.log(`  Email: ${email}`);
        console.log(`  Username: ${username}`);
        console.log(`  Password: [hidden]`);
        console.log('');
        console.log('You can now log in with these credentials.');

    } catch (error) {
        console.error('❌ Bootstrap failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Helper function to generate profile slug
function generateSlug(username: string): string {
    return username.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// Run the bootstrap script
bootstrapAdmin().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});