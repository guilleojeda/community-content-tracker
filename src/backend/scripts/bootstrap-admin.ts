#!/usr/bin/env node
/**
 * Admin Bootstrap Script
 * Creates the first admin user for the AWS Community Content Hub
 *
 * Usage:
 *   npm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Pool } from 'pg';
import { Visibility } from '@aws-community-hub/shared';
import { UserRepository } from '../repositories/UserRepository';

export interface ParsedArgs {
  email: string;
  username: string;
  password: string;
}

export interface BootstrapEnvironment {
  databaseUrl: string;
  region: string;
  userPoolId: string;
  clientId: string;
}

const USAGE =
  'Usage: npm run bootstrap:admin -- --email admin@example.com --username admin --password SecureAdminPass123!';

const REQUIRED_DB_PARTS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const;

function hasDatabaseParts(env: NodeJS.ProcessEnv): boolean {
  return REQUIRED_DB_PARTS.every((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

function buildDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const host = env.DB_HOST as string;
  const port = (env.DB_PORT as string) || '5432';
  const database = env.DB_NAME as string;
  const user = encodeURIComponent(env.DB_USER as string);
  const password = env.DB_PASSWORD ? encodeURIComponent(env.DB_PASSWORD) : '';
  const credentials = password ? `${user}:${password}` : user;

  return `postgresql://${credentials}@${host}:${port}/${database}`;
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL && env.DATABASE_URL.trim() !== '') {
    return env.DATABASE_URL;
  }

  if (hasDatabaseParts(env)) {
    return buildDatabaseUrl(env);
  }

  throw new Error(
    'Invalid environment: DATABASE_URL is required. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.'
  );
}

export function parseArgs(args: string[] = process.argv.slice(2)): ParsedArgs {
  const email = getArg(args, '--email');
  const username = getArg(args, '--username');
  const password = getArg(args, '--password');

  if (!email || !username || !password) {
    console.error(USAGE);
    throw new Error('INVALID_ARGUMENTS');
  }

  if (password.length < 12) {
    console.error('Password must be at least 12 characters long');
    throw new Error('INVALID_ARGUMENTS');
  }

  const complexityPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/;
  if (!complexityPattern.test(password)) {
    console.error(
      'Password must contain lowercase, uppercase, numbers, and special characters'
    );
    throw new Error('INVALID_ARGUMENTS');
  }

  return { email, username, password };
}

function getArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index > -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): BootstrapEnvironment {
  const databaseUrl = resolveDatabaseUrl(env);
  const region = env.AWS_REGION || 'us-east-1';
  const userPoolId = env.COGNITO_USER_POOL_ID;
  const clientId = env.COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    console.error('Missing required environment variables: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID');
    throw new Error('INVALID_ENVIRONMENT');
  }

  return { databaseUrl, region, userPoolId, clientId };
}

export function generateSlug(username: string): string {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface BootstrapDeps {
  pool?: Pool;
  userRepository?: UserRepository;
  cognitoClient?: CognitoIdentityProviderClient;
}

export async function bootstrapAdmin(
  overrides: Partial<ParsedArgs> = {},
  deps: BootstrapDeps = {}
): Promise<void> {
  const args: ParsedArgs =
    overrides.email && overrides.username && overrides.password
      ? {
          email: overrides.email as string,
          username: overrides.username as string,
          password: overrides.password as string,
        }
      : parseArgs();
  const env = validateEnvironment();

  const pool = deps.pool ?? new Pool({ connectionString: env.databaseUrl });
  const userRepository = deps.userRepository ?? new UserRepository(pool);
  const cognitoClient =
    deps.cognitoClient ?? new CognitoIdentityProviderClient({ region: env.region });

  try {
    const email = overrides.email ?? args.email;
    const username = overrides.username ?? args.username;
    const password = overrides.password ?? args.password;

    const existingUser = await userRepository.findByEmail(email);
  if (existingUser?.isAdmin) {
    console.log('Admin user already exists. Script is idempotent, no action needed.');
    return;
  }

  if (existingUser && !existingUser.isAdmin) {
    await userRepository.promoteToAdmin(existingUser.id);
    console.log('User promoted to admin successfully.');
    return;
  }

    try {
      const createUserCommand = new AdminCreateUserCommand({
        UserPoolId: env.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:username', Value: username },
          { Name: 'custom:default_visibility', Value: 'public' },
          { Name: 'custom:is_admin', Value: 'true' },
        ],
        TemporaryPassword: password,
        MessageAction: 'SUPPRESS',
      });

      const createResult = await cognitoClient.send(createUserCommand);

      const setPasswordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: env.userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      });
      await cognitoClient.send(setPasswordCommand);

      const addToGroupCommand = new AdminAddUserToGroupCommand({
        UserPoolId: env.userPoolId,
        Username: email,
        GroupName: 'admin',
      });
      await cognitoClient.send(addToGroupCommand);

      const cognitoUsername =
        createResult && typeof createResult === 'object' && (createResult as any).User?.Username
          ? (createResult as any).User.Username
          : email;
      await createDatabaseUser(userRepository, cognitoUsername, {
        email,
        username,
      });

      console.log('Admin bootstrap completed successfully.');
      console.log('You can now log in with the provided admin credentials.');
      return;
    } catch (error: any) {
      if (error?.name === 'UsernameExistsException') {
        console.log('User already exists in Cognito, ensuring admin privileges are set.');

        const updateAttributesCommand = new AdminUpdateUserAttributesCommand({
          UserPoolId: env.userPoolId,
          Username: email,
          UserAttributes: [{ Name: 'custom:is_admin', Value: 'true' }],
        });
        await cognitoClient.send(updateAttributesCommand);

        try {
          const addToGroupCommand = new AdminAddUserToGroupCommand({
            UserPoolId: env.userPoolId,
            Username: email,
            GroupName: 'admin',
          });
          await cognitoClient.send(addToGroupCommand);
        } catch (groupError: any) {
          if (groupError?.name !== 'UserNotFoundException') {
            throw groupError;
          }
        }

        await createDatabaseUser(userRepository, email, { email, username });
        console.log('Admin bootstrap completed successfully.');
        console.log('You can now log in with the provided admin credentials.');
        return;
      }

      throw error;
    }
  } catch (error) {
    console.error('Bootstrap failed:', error);
    throw error;
  } finally {
    if (typeof pool.end === 'function') {
      await pool.end();
    }
  }
}

async function createDatabaseUser(
  userRepository: UserRepository,
  cognitoSub: string,
  params: { email: string; username: string }
): Promise<void> {
  const profileSlug = generateSlug(params.username);
  const isAwsEmployee =
    params.email.endsWith('@amazon.com') || params.email.endsWith('@aws.com');

  await userRepository.createUser({
    cognitoSub,
    email: params.email,
    username: params.username,
    profileSlug,
    defaultVisibility: 'public' as Visibility,
    isAdmin: true,
    isAwsEmployee,
  });
}

async function run() {
  try {
    await bootstrapAdmin();
  } catch (error) {
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}
