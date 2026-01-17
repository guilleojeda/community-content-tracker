import { resolveAuthorizerContext } from '../../../src/backend/services/authorizerContext';

describe('resolveAuthorizerContext', () => {
  it('prefers explicit authorizer fields', () => {
    const context = resolveAuthorizerContext({
      userId: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      isAdmin: true,
      isAwsEmployee: 'true',
      groups: ['team'],
    });

    expect(context).toEqual({
      userId: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      isAdmin: true,
      isAwsEmployee: true,
    });
  });

  it('derives fields from claims and parses JSON group lists', () => {
    const context = resolveAuthorizerContext({
      claims: {
        sub: 'sub-1',
        username: 'bob',
        email: 'bob@example.com',
        'cognito:groups': '["Admins","team"]',
        'custom:is_admin': 'false',
        'custom:is_aws_employee': 'false',
      },
    });

    expect(context.userId).toBe('sub-1');
    expect(context.username).toBe('bob');
    expect(context.email).toBe('bob@example.com');
    expect(context.isAdmin).toBe(true);
    expect(context.isAwsEmployee).toBe(false);
  });

  it('parses comma-separated groups when JSON parsing fails', () => {
    const context = resolveAuthorizerContext({
      groups: 'admins, staff',
      isAdmin: 'false',
      isAwsEmployee: false,
      claims: {
        'cognito:username': 'cognito-user',
      },
    });

    expect(context.userId).toBe('cognito-user');
    expect(context.username).toBe('cognito-user');
    expect(context.isAdmin).toBe(true);
    expect(context.isAwsEmployee).toBe(false);
  });

  it('returns defaults when authorizer is missing', () => {
    const context = resolveAuthorizerContext(undefined);

    expect(context.userId).toBeUndefined();
    expect(context.username).toBeUndefined();
    expect(context.email).toBeUndefined();
    expect(context.isAdmin).toBe(false);
    expect(context.isAwsEmployee).toBe(false);
  });

  it('ignores unsupported group payloads', () => {
    const context = resolveAuthorizerContext({
      groups: 123 as unknown as string[],
    });

    expect(context.isAdmin).toBe(false);
    expect(context.isAwsEmployee).toBe(false);
  });
});
