import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { logSearchAnalytics } from '@lambdas/search/searchHandler';

describe('logSearchAnalytics', () => {
  const basePayload = {
    query: 'aws lambda',
    resultCount: 5,
    latency: 42,
    filters: { visibility: ['public'] },
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('publishes CloudWatch metrics with authenticated dimension', async () => {
    const send = jest.fn().mockResolvedValue({});
    const fakeClient = { send } as any;

    await logSearchAnalytics(
      {
        ...basePayload,
        userId: 'user-123',
      },
      fakeClient
    );

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutMetricDataCommand;
    const input: any = command.input;

    expect(input.Namespace).toBe('CommunityContentHub/Search');
    const zeroMetric = input.MetricData?.find((metric: any) => metric.MetricName === 'ZeroResultSearches');
    expect(zeroMetric?.Value).toBe(0);
    const countMetric = input.MetricData?.find((metric: any) => metric.MetricName === 'SearchCount');
    expect(countMetric?.Dimensions?.[0]).toEqual({ Name: 'UserType', Value: 'authenticated' });
  });

  it('marks zero-result searches correctly', async () => {
    const send = jest.fn().mockResolvedValue({});
    const fakeClient = { send } as any;

    await logSearchAnalytics(
      {
        ...basePayload,
        resultCount: 0,
        userId: undefined,
      },
      fakeClient
    );

    const command = send.mock.calls[0][0] as PutMetricDataCommand;
    const input: any = command.input;
    const zeroMetric = input.MetricData?.find((metric: any) => metric.MetricName === 'ZeroResultSearches');
    expect(zeroMetric?.Value).toBe(1);
    const countMetric = input.MetricData?.find((metric: any) => metric.MetricName === 'SearchCount');
    expect(countMetric?.Dimensions?.[0]).toEqual({ Name: 'UserType', Value: 'anonymous' });
  });
});
