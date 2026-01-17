import {
  SecretsManagerClient,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';

const secretsClient = new SecretsManagerClient({});
const ssmClient = new SSMClient({});

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Rotation lambda missing required environment variable: ${name}`);
  }
  return value;
}

interface RotationEvent {
  SecretId: string;
  ClientRequestToken: string;
  Step: 'createSecret' | 'setSecret' | 'testSecret' | 'finishSecret';
}

const pendingParameterName = process.env.PENDING_PARAMETER_NAME;
const secretAlias = requireEnv('SECRET_ALIAS', process.env.SECRET_ALIAS);

async function fetchPendingKey(): Promise<string> {
  const parameterName = requireEnv('PENDING_PARAMETER_NAME', pendingParameterName);
  const parameter = await ssmClient
    .send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    )
    .catch((error) => {
      if (error.name === 'ParameterNotFound') {
        throw new Error(
          `No pending ${secretAlias} found in SSM parameter ${parameterName}. ` +
            'Provide the new key before triggering rotation.'
        );
      }
      throw error;
    });

  const value = parameter.Parameter?.Value?.trim();
  if (!value) {
    throw new Error(
      `Pending parameter ${parameterName} is empty. Provide the new ${secretAlias} before rotation.`
    );
  }
  return value;
}

async function putPendingSecret(event: RotationEvent, secretString: string): Promise<void> {
  try {
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: event.SecretId,
        ClientRequestToken: event.ClientRequestToken,
        SecretString: secretString,
        VersionStages: ['AWSPENDING'],
      })
    );
  } catch (error: any) {
    if (error.name !== 'ResourceExistsException') {
      throw error;
    }
    // When the same client token replays, ignore the exception – the version already exists.
  }
}

async function testPendingSecret(event: RotationEvent): Promise<void> {
  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: event.SecretId,
      VersionId: event.ClientRequestToken,
      VersionStage: 'AWSPENDING',
    })
  );

  const value = result.SecretString?.trim();
  if (!value) {
    throw new Error(`Pending ${secretAlias} value is empty – aborting rotation.`);
  }
}

async function finishSecret(event: RotationEvent): Promise<void> {
  const describe = await secretsClient.send(
    new DescribeSecretCommand({
      SecretId: event.SecretId,
    })
  );

  const versionStages = describe.VersionIdsToStages ?? {};
  const currentVersionEntry = Object.entries(versionStages).find(([, stages]) =>
    stages?.includes('AWSCURRENT')
  );

  const currentVersion = currentVersionEntry?.[0];
  if (currentVersion === event.ClientRequestToken) {
    // Already marked as current
    return;
  }

  await secretsClient.send(
    new UpdateSecretVersionStageCommand({
      SecretId: event.SecretId,
      VersionStage: 'AWSCURRENT',
      MoveToVersionId: event.ClientRequestToken,
      RemoveFromVersionId: currentVersion,
    })
  );

  const parameterName = requireEnv('PENDING_PARAMETER_NAME', pendingParameterName);
  await ssmClient
    .send(
      new DeleteParameterCommand({
        Name: parameterName,
      })
    )
    .catch((error) => {
      if (error.name !== 'ParameterNotFound') {
        throw error;
      }
    });
}

export const handler = async (event: RotationEvent): Promise<void> => {
  if (!event || !event.Step) {
    throw new Error('Rotation event is missing required properties.');
  }

  switch (event.Step) {
    case 'createSecret': {
      const newKey = await fetchPendingKey();
      await putPendingSecret(event, newKey);
      break;
    }
    case 'setSecret':
      // No additional action required – value was written during createSecret
      break;
    case 'testSecret':
      await testPendingSecret(event);
      break;
    case 'finishSecret':
      await finishSecret(event);
      break;
    default:
      throw new Error(`Unsupported rotation step: ${event.Step}`);
  }
};
