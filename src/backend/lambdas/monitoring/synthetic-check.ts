import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudWatchClient = new CloudWatchClient({});

interface SyntheticResult {
  statusCode: number;
  body: string;
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value.trim();
};

const putMetrics = async (namespace: string, availability: number, latencyMs: number) => {
  await cloudWatchClient.send(
    new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: [
        {
          MetricName: 'Availability',
          Value: availability,
          Unit: 'Percent',
        },
        {
          MetricName: 'Latency',
          Value: latencyMs,
          Unit: 'Milliseconds',
        },
      ],
    })
  );
};

export const handler = async (): Promise<SyntheticResult> => {
  const url = requireEnv('SYNTHETIC_URL');
  const namespace = requireEnv('CLOUDWATCH_NAMESPACE');

  const start = Date.now();
  let statusCode = 0;

  try {
    const response = await fetch(url, { method: 'GET' });
    statusCode = response.status;
    const latency = Date.now() - start;

    if (!response.ok) {
      await putMetrics(namespace, 0, latency);
      throw new Error(`Synthetic check failed with status ${response.status}`);
    }

    await putMetrics(namespace, 100, latency);
    return {
      statusCode: 200,
      body: JSON.stringify({
        url,
        latency,
        status: response.status,
      }),
    };
  } catch (error: any) {
    const latency = Date.now() - start;
    await putMetrics(namespace, 0, latency);

    console.error('Synthetic health check failed', {
      error: error?.message ?? 'unknown error',
      statusCode,
      url,
      latency,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        url,
        statusCode,
        error: error?.message ?? 'Synthetic check failed',
      }),
    };
  }
};
