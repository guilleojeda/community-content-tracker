import * as vm from 'vm';
import { preSignupLambdaSource } from '../../src/infrastructure/lib/lambdas/pre-signup-code';

type PreSignupHandler = (
  event: any,
  context: any,
  callback: (error: any, result?: any) => void
) => Promise<void>;

function createHandler(): PreSignupHandler {
  const sandbox: Record<string, any> = {
    console,
    exports: {},
    module: { exports: {} },
    require: (moduleName: string) => {
      if (moduleName === 'aws-sdk') {
        return {
          CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
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

  beforeEach(() => {
    handler = createHandler();
  });

  it('accepts valid username and visibility attributes', async () => {
    const event = {
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
    expect(event.response.autoConfirmUser).toBe(false);
    expect(event.response.autoVerifyEmail).toBe(true);
  });

  it('rejects invalid username formats', async () => {
    const event = {
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
  });

  it('rejects unsupported default visibility values', async () => {
    const event = {
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
  });

  it('rejects invalid is_admin flag values', async () => {
    const event = {
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
  });
});
