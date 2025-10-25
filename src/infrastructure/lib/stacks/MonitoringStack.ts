import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface MonitoringStackProps extends cdk.StackProps {
  environment: string;
  searchFunction: lambda.IFunction;
  statsFunction: lambda.IFunction;
  analyticsTrackFunction: lambda.IFunction;
  analyticsUserFunction: lambda.IFunction;
  analyticsExportFunction: lambda.IFunction;
  dataRetentionFunction: lambda.IFunction;
  userExportFunction: lambda.IFunction;
  userDeleteAccountFunction: lambda.IFunction;
  userManageConsentFunction: lambda.IFunction;
  feedbackIngestFunction: lambda.IFunction;
  databaseCluster: rds.DatabaseCluster;
  databaseProxy: rds.DatabaseProxy;
  contentQueue: sqs.Queue;
  contentDeadLetterQueue: sqs.Queue;
  syntheticCheckUrl?: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const envName = props.environment;

    const alertTopic = new sns.Topic(this, 'OperationsAlertTopic', {
      topicName: `community-content-ops-${envName}`,
      displayName: `Community Content Hub ${envName} Alerts`,
    });

    const alarmActions = [new actions.SnsAction(alertTopic)];

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `community-content-hub-${envName}-operations`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    const addLambdaWidgets = (fn: lambda.IFunction, title: string) => {
      dashboard.addWidgets(
        new cloudwatch.TextWidget({
          markdown: `### ${title}`,
          width: 24,
          height: 1,
        }),
        new cloudwatch.GraphWidget({
          width: 12,
          title: `${title} Invocations`,
          left: [fn.metricInvocations({ period: cdk.Duration.minutes(5), statistic: 'sum' })],
        }),
        new cloudwatch.GraphWidget({
          width: 12,
          title: `${title} Errors`,
          left: [fn.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'sum' })],
        }),
        new cloudwatch.GraphWidget({
          width: 12,
          title: `${title} Duration (p99)`,
          left: [
            fn.metricDuration({
              statistic: 'p99',
              period: cdk.Duration.minutes(5),
            }),
          ],
        })
      );
    };

    addLambdaWidgets(props.searchFunction, 'Search API');
    addLambdaWidgets(props.statsFunction, 'Stats API');
    addLambdaWidgets(props.analyticsTrackFunction, 'Analytics Events');
    addLambdaWidgets(props.analyticsUserFunction, 'User Analytics API');
    addLambdaWidgets(props.analyticsExportFunction, 'Analytics Export API');
    addLambdaWidgets(props.dataRetentionFunction, 'Data Retention Job');
    addLambdaWidgets(props.userExportFunction, 'User GDPR Export');
    addLambdaWidgets(props.userDeleteAccountFunction, 'User Account Deletion');
    addLambdaWidgets(props.userManageConsentFunction, 'User Consent API');
    addLambdaWidgets(props.feedbackIngestFunction, 'Feedback Ingest API');

    const dbConnections = props.databaseCluster.metricDatabaseConnections({
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
    });

    const proxyConnections = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'DatabaseConnections',
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
      dimensionsMap: {
        DBProxyIdentifier: props.databaseProxy.dbProxyName,
      },
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### Database`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.GraphWidget({
        title: 'Database Connections',
        width: 12,
        left: [dbConnections],
      }),
      new cloudwatch.GraphWidget({
        title: 'CPU Utilization',
        width: 12,
        left: [
          props.databaseCluster.metricCPUUtilization({
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Proxy Connections',
        width: 12,
        left: [proxyConnections],
      })
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### Content Queues`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        title: 'Queue Depth',
        left: [
          props.contentQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        title: 'DLQ Messages',
        left: [
          props.contentDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
      })
    );

    const createErrorRateAlarm = (
      scopeId: string,
      fn: lambda.IFunction,
      label: string
    ) => {
      const errors = fn.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'sum',
      });
      const invocations = fn.metricInvocations({
        period: cdk.Duration.minutes(5),
        statistic: 'sum',
      });
      const errorRate = new cloudwatch.MathExpression({
        expression: 'errors / MAX([invocations,1])',
        usingMetrics: {
          errors,
          invocations,
        },
        label: `${label} Error Rate`,
        period: cdk.Duration.minutes(5),
      });

      const alarm = new cloudwatch.Alarm(this, scopeId, {
        metric: errorRate,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        threshold: 0.01,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${label} error rate exceeded 1%`,
      });

      alarm.addAlarmAction(...alarmActions);
    };

    createErrorRateAlarm('SearchErrorRateAlarm', props.searchFunction, 'Search');
    createErrorRateAlarm('StatsErrorRateAlarm', props.statsFunction, 'Stats');
    createErrorRateAlarm('AnalyticsTrackErrorRateAlarm', props.analyticsTrackFunction, 'Analytics Track');
    createErrorRateAlarm('FeedbackErrorRateAlarm', props.feedbackIngestFunction, 'Feedback Ingest');

    const createLatencyAlarm = (
      scopeId: string,
      fn: lambda.IFunction,
      label: string
    ) => {
      const latencyAlarm = new cloudwatch.Alarm(this, scopeId, {
        metric: fn.metricDuration({
          statistic: 'p99',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1000,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} latency p99 above 1s`,
      });
      latencyAlarm.addAlarmAction(...alarmActions);
    };

    createLatencyAlarm('SearchLatencyAlarm', props.searchFunction, 'Search');
    createLatencyAlarm('AnalyticsLatencyAlarm', props.analyticsUserFunction, 'User Analytics');
    createLatencyAlarm('FeedbackLatencyAlarm', props.feedbackIngestFunction, 'Feedback Ingest');

    const dbConnectionAlarm = new cloudwatch.Alarm(this, 'DatabaseConnectionsAlarm', {
      metric: dbConnections,
      threshold: 70,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Database connections above 70',
    });
    dbConnectionAlarm.addAlarmAction(...alarmActions);

    const dlqAlarm = new cloudwatch.Alarm(this, 'ContentDlqAlarm', {
      metric: props.contentDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Messages detected in content processing DLQ',
    });
    dlqAlarm.addAlarmAction(...alarmActions);

    const costMetric = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      statistic: 'Maximum',
      period: cdk.Duration.hours(6),
      dimensionsMap: {
        Currency: 'USD',
      },
      region: 'us-east-1',
    });

    const costAlarm = new cloudwatch.Alarm(this, 'DailyCostAlarm', {
      metric: costMetric,
      threshold: 500,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Estimated daily AWS spend exceeded $500',
    });
    costAlarm.addAlarmAction(...alarmActions);

    const syntheticNamespace = `CommunityContentHub/Synthetic/${envName}`;
    const syntheticFunction = new lambda.Function(this, 'SyntheticHealthCheckFunction', {
      functionName: `community-content-tracker-${envName}-synthetic`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'synthetic-check.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../backend/lambdas/monitoring')
      ),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        SYNTHETIC_URL: props.syntheticCheckUrl ?? 'https://example.org/',
        CLOUDWATCH_NAMESPACE: syntheticNamespace,
      },
      description: 'Synthetic monitor for critical user journey',
    });

    syntheticFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    const syntheticSchedule = new events.Rule(this, 'SyntheticMonitorSchedule', {
      ruleName: `synthetic-monitor-${envName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    syntheticSchedule.addTarget(new targets.LambdaFunction(syntheticFunction));

    const syntheticAvailabilityMetric = new cloudwatch.Metric({
      namespace: syntheticNamespace,
      metricName: 'Availability',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const syntheticAlarm = new cloudwatch.Alarm(this, 'SyntheticAvailabilityAlarm', {
      metric: syntheticAvailabilityMetric,
      threshold: 99,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: 'Synthetic monitoring detected availability below 99%',
    });
    syntheticAlarm.addAlarmAction(...alarmActions);

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### Synthetic Monitoring`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.GraphWidget({
        title: 'Synthetic Availability',
        width: 12,
        left: [syntheticAvailabilityMetric],
      }),
      new cloudwatch.GraphWidget({
        title: 'Synthetic Latency',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: syntheticNamespace,
            metricName: 'Latency',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
      })
    );

    new cdk.CfnOutput(this, 'OperationsDashboardName', {
      value: dashboard.dashboardName,
      description: 'CloudWatch Operations dashboard name',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS topic ARN for operational alerts',
    });
  }
}
