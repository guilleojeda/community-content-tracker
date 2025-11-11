process.env.PENDING_PARAMETER_NAME = process.env.PENDING_PARAMETER_NAME ?? '/dev/api-keys/youtube/pending';
process.env.SECRET_ALIAS = 'YouTube API key';

import { handler } from '../../../src/infrastructure/lib/lambdas/api-key-rotation';

var secretsSendMock: jest.Mock;
var ssmSendMock: jest.Mock;

jest.mock('@aws-sdk/client-secrets-manager', () => {
  secretsSendMock = jest.fn();

  const createCommandClass = (type: string) =>
    class {
      public readonly __type = type;
      public readonly input: Record<string, unknown>;

      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    };

  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: secretsSendMock })),
    DescribeSecretCommand: createCommandClass('DescribeSecretCommand'),
    GetSecretValueCommand: createCommandClass('GetSecretValueCommand'),
    PutSecretValueCommand: createCommandClass('PutSecretValueCommand'),
    UpdateSecretVersionStageCommand: createCommandClass('UpdateSecretVersionStageCommand'),
  };
});

jest.mock('@aws-sdk/client-ssm', () => {
  ssmSendMock = jest.fn();

  const createCommandClass = (type: string) =>
    class {
      public readonly __type = type;
      public readonly input: Record<string, unknown>;

      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    };

  return {
    SSMClient: jest.fn().mockImplementation(() => ({ send: ssmSendMock })),
    GetParameterCommand: createCommandClass('GetParameterCommand'),
    DeleteParameterCommand: createCommandClass('DeleteParameterCommand'),
  };
});

describe('api-key-rotation handler', () => {
  const eventBase = {
    SecretId: 'youtube-secret',
    ClientRequestToken: 'example-token',
  };

  beforeEach(() => {
    secretsSendMock.mockReset();
    ssmSendMock.mockReset();
    secretsSendMock.mockImplementation(() => Promise.resolve({}));
    ssmSendMock.mockImplementation(() => Promise.resolve({}));
  });

  it('writes pending secrets from SSM when createSecret step runs', async () => {
    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'GetParameterCommand') {
        return Promise.resolve({ Parameter: { Value: 'new-key-value' } });
      }
      return Promise.resolve({});
    });

    secretsSendMock.mockResolvedValue({});

    await handler({
      ...eventBase,
      Step: 'createSecret',
    });

    expect(ssmSendMock).toHaveBeenCalledWith(expect.objectContaining({ __type: 'GetParameterCommand' }));
    expect(secretsSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        __type: 'PutSecretValueCommand',
        input: expect.objectContaining({
          SecretId: 'youtube-secret',
          SecretString: 'new-key-value',
          VersionStages: ['AWSPENDING'],
        }),
      })
    );
  });

  it('throws a helpful error when pending parameter is missing', async () => {
    ssmSendMock.mockImplementation(() => {
      const error: NodeJS.ErrnoException = new Error('Not found');
      error.name = 'ParameterNotFound';
      return Promise.reject(error);
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'createSecret',
      })
    ).rejects.toThrow(/Provide the new key/);
  });

  it('rejects empty pending secrets during testSecret', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'GetSecretValueCommand') {
        return { SecretString: '' };
      }
      return {};
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'testSecret',
      })
    ).rejects.toThrow(/Pending .* value is empty/);
  });

  it('promotes pending version and deletes staged parameter during finishSecret', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'DescribeSecretCommand') {
        return Promise.resolve({
          VersionIdsToStages: {
            current: ['AWSCURRENT'],
          },
        });
      }

      return Promise.resolve({});
    });

    await handler({
      ...eventBase,
      Step: 'finishSecret',
    });

    expect(secretsSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        __type: 'UpdateSecretVersionStageCommand',
        input: expect.objectContaining({
          MoveToVersionId: 'example-token',
          VersionStage: 'AWSCURRENT',
        }),
      })
    );

    expect(ssmSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        __type: 'DeleteParameterCommand',
        input: expect.objectContaining({
          Name: '/dev/api-keys/youtube/pending',
        }),
      })
    );
  });
});
