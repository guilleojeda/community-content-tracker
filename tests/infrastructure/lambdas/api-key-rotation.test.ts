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

  it('ignores ResourceExistsException when writing pending secrets', async () => {
    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'GetParameterCommand') {
        return Promise.resolve({ Parameter: { Value: 'new-key-value' } });
      }
      return Promise.resolve({});
    });

    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'PutSecretValueCommand') {
        const error: NodeJS.ErrnoException = new Error('Resource exists');
        error.name = 'ResourceExistsException';
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'createSecret',
      })
    ).resolves.toBeUndefined();
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

  it('throws when the pending parameter is empty', async () => {
    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'GetParameterCommand') {
        return Promise.resolve({ Parameter: { Value: '' } });
      }
      return Promise.resolve({});
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'createSecret',
      })
    ).rejects.toThrow(/Pending parameter .* is empty/);
  });

  it('surfaces non-ResourceExists errors when writing pending secrets', async () => {
    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'GetParameterCommand') {
        return Promise.resolve({ Parameter: { Value: 'new-key-value' } });
      }
      return Promise.resolve({});
    });

    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'PutSecretValueCommand') {
        const error: NodeJS.ErrnoException = new Error('Access denied');
        error.name = 'AccessDeniedException';
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'createSecret',
      })
    ).rejects.toThrow('Access denied');
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

  it('allows setSecret step without additional actions', async () => {
    await expect(
      handler({
        ...eventBase,
        Step: 'setSecret',
      })
    ).resolves.toBeUndefined();

    expect(secretsSendMock).not.toHaveBeenCalled();
    expect(ssmSendMock).not.toHaveBeenCalled();
  });

  it('throws when rotation event is missing a step', async () => {
    await expect(handler({ ...eventBase } as any)).rejects.toThrow(
      'Rotation event is missing required properties.'
    );
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

  it('promotes pending version when no current version is flagged', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'DescribeSecretCommand') {
        return Promise.resolve({
          VersionIdsToStages: {
            pending: ['AWSPENDING'],
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
  });

  it('promotes pending version when version stages are missing', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'DescribeSecretCommand') {
        return Promise.resolve({});
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
  });

  it('treats undefined stage entries as not current', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'DescribeSecretCommand') {
        return Promise.resolve({
          VersionIdsToStages: {
            current: undefined,
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
      })
    );
  });

  it('skips promotion when pending version is already current', async () => {
    secretsSendMock.mockImplementation((command) => {
      if (command.__type === 'DescribeSecretCommand') {
        return Promise.resolve({
          VersionIdsToStages: {
            [eventBase.ClientRequestToken]: ['AWSCURRENT'],
          },
        });
      }
      return Promise.resolve({});
    });

    await handler({
      ...eventBase,
      Step: 'finishSecret',
    });

    expect(secretsSendMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        __type: 'UpdateSecretVersionStageCommand',
      })
    );
  });

  it('fails when pending parameter cleanup encounters unexpected errors', async () => {
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

    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'DeleteParameterCommand') {
        const error: NodeJS.ErrnoException = new Error('Access denied');
        error.name = 'AccessDeniedException';
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'finishSecret',
      })
    ).rejects.toThrow('Access denied');
  });

  it('ignores missing pending parameter during finishSecret cleanup', async () => {
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

    ssmSendMock.mockImplementation((command) => {
      if (command.__type === 'DeleteParameterCommand') {
        const error: NodeJS.ErrnoException = new Error('Missing');
        error.name = 'ParameterNotFound';
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    await expect(
      handler({
        ...eventBase,
        Step: 'finishSecret',
      })
    ).resolves.toBeUndefined();
  });

  it('throws on unsupported rotation steps', async () => {
    await expect(
      handler({
        ...eventBase,
        Step: 'unsupported' as any,
      })
    ).rejects.toThrow(/Unsupported rotation step/);
  });

  it('throws when SECRET_ALIAS is missing at module load', () => {
    const previousAlias = process.env.SECRET_ALIAS;
    delete process.env.SECRET_ALIAS;

    try {
      jest.isolateModules(() => {
        expect(() => require('../../../src/infrastructure/lib/lambdas/api-key-rotation')).toThrow(
          /SECRET_ALIAS/
        );
      });
    } finally {
      if (previousAlias === undefined) {
        delete process.env.SECRET_ALIAS;
      } else {
        process.env.SECRET_ALIAS = previousAlias;
      }
    }
  });
});
