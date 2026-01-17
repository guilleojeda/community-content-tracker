import * as vm from 'vm';
import { preSignupLambdaSource } from '../../src/infrastructure/lib/lambdas/pre-signup-code';

type PreSignupHandler = (
  event: any,
  context: any,
  callback: (error: any, result?: any) => void
) => Promise<void>;

function createHandler(listUsersMock: jest.Mock): PreSignupHandler {
  const sandbox: Record<string, any> = {
    console,
    exports: {},
    module: { exports: {} },
    require: (moduleName: string) => {
      if (moduleName === 'aws-sdk') {
        return {
          CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({
            listUsers: listUsersMock,
          })),
        };
      }

      throw new Error(`Unexpected module import: ${moduleName}`);
    },
    process,
    setTimeout,
    clearTimeout,
  };

  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(preSignupLambdaSource, sandbox);
  return sandbox.module.exports.handler as PreSignupHandler;
}

describe('Pre-signup Lambda Handler (behavioural)', () => {
  let handler: PreSignupHandler;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let listUsersMock: jest.Mock;

  beforeEach(() => {
    listUsersMock = jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Users: [] }),
    });
    handler = createHandler(listUsersMock);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('accepts valid username and visibility attributes', async () => {
    const event = {
      userPoolId: 'us-east-1_test',
      request: {
        userAttributes: {
          'custom:username': 'Valid_User123',
          'custom:default_visibility': 'public',
          'custom:is_admin': 'false',
        },
      },
      response: {},
    };
    const callback = jest.fn();

    await handler(event, {}, callback);

    expect(callback).toHaveBeenCalledWith(null, event);
    expect(listUsersMock).toHaveBeenCalledWith({
      UserPoolId: 'us-east-1_test',
      Filter: 'custom:username = "Valid_User123"',
      Limit: 1,
    });
    expect(event.response.autoConfirmUser).toBe(false);
    expect(event.response.autoVerifyEmail).toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid username formats', async () => {
    const event = {
      userPoolId: 'us-east-1_test',
      request: {
        userAttributes: {
          'custom:username': '_invalid',
        },
      },
      response: {},
    };
    const callback = jest.fn();

    await handler(event, {}, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const error = callback.mock.calls[0][0];
    expect(error?.name).toBe('InvalidParameterException');
    expect(error?.message).toContain('Username must be 3-50 characters');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, loggedError] = consoleErrorSpy.mock.calls[0];
    expect(message).toBe('Pre-signup validation failed:');
    expect(loggedError).toBe(error);
  });

  it('rejects unsupported default visibility values', async () => {
    const event = {
      userPoolId: 'us-east-1_test',
      request: {
        userAttributes: {
          'custom:username': 'ValidUser',
          'custom:default_visibility': 'friends_only',
        },
      },
      response: {},
    };
    const callback = jest.fn();

    await handler(event, {}, callback);

    const error = callback.mock.calls[0][0];
    expect(error?.name).toBe('InvalidParameterException');
    expect(error?.message).toContain('default_visibility must be one of');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, loggedError] = consoleErrorSpy.mock.calls[0];
    expect(message).toBe('Pre-signup validation failed:');
    expect(loggedError).toBe(error);
  });

  it('rejects invalid is_admin flag values', async () => {
    const event = {
      userPoolId: 'us-east-1_test',
      request: {
        userAttributes: {
          'custom:username': 'ValidUser',
          'custom:is_admin': 'maybe',
        },
      },
      response: {},
    };
    const callback = jest.fn();

    await handler(event, {}, callback);

    const error = callback.mock.calls[0][0];
    expect(error?.name).toBe('InvalidParameterException');
    expect(error?.message).toContain('is_admin must be either true or false');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, loggedError] = consoleErrorSpy.mock.calls[0];
    expect(message).toBe('Pre-signup validation failed:');
    expect(loggedError).toBe(error);
  });

  it('rejects duplicate usernames', async () => {
    listUsersMock.mockReturnValueOnce({
      promise: jest.fn().mockResolvedValue({ Users: [{ Username: 'existing-user' }] }),
    });

    const event = {
      userPoolId: 'us-east-1_test',
      request: {
        userAttributes: {
          'custom:username': 'ValidUser',
        },
      },
      response: {},
    };
    const callback = jest.fn();

    await handler(event, {}, callback);

    const error = callback.mock.calls[0][0];
    expect(error?.name).toBe('InvalidParameterException');
    expect(error?.message).toContain('Username already exists');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
