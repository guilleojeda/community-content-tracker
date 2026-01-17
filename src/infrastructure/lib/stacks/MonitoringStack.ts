import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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
    const syntheticUrl = props.syntheticCheckUrl ?? process.env.SYNTHETIC_URL;
    if (!syntheticUrl || syntheticUrl.trim().length === 0) {
      throw new Error('SYNTHETIC_URL must be provided via props or environment variable');
    }

    const requireNumberEnv = (name: string): number => {
      const raw = process.env[name];
      if (!raw || raw.trim().length === 0) {
        throw new Error(`${name} must be set`);
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a valid number`);
      }
      return parsed;
    };

    const errorRateThreshold = requireNumberEnv('MONITORING_ERROR_RATE_THRESHOLD');
    const latencyThresholdMs = requireNumberEnv('MONITORING_P99_LATENCY_MS');
    const dbConnectionThreshold = requireNumberEnv('MONITORING_DB_CONNECTION_THRESHOLD');
    const dlqThreshold = requireNumberEnv('MONITORING_DLQ_THRESHOLD');
    const dailyCostThreshold = requireNumberEnv('MONITORING_DAILY_COST_THRESHOLD');
    const syntheticAvailabilityThreshold = requireNumberEnv('MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD');

    const billingRegion = (
      process.env.MONITORING_BILLING_REGION
      || process.env.BILLING_REGION
      || process.env.AWS_BILLING_REGION
    )?.trim();
    if (!billingRegion) {
      throw new Error('MONITORING_BILLING_REGION must be set for billing alarms');
    }
    const depsLockFilePath = path.join(__dirname, '../../../../package-lock.json');
    const lambdaEntryPath = path.join(__dirname, '../../../backend/lambdas');

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
        threshold: errorRateThreshold,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${label} error rate exceeded ${errorRateThreshold * 100}%`,
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
        threshold: latencyThresholdMs,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} latency p99 above ${latencyThresholdMs}ms`,
      });
      latencyAlarm.addAlarmAction(...alarmActions);
    };

    createLatencyAlarm('SearchLatencyAlarm', props.searchFunction, 'Search');
    createLatencyAlarm('AnalyticsLatencyAlarm', props.analyticsUserFunction, 'User Analytics');
    createLatencyAlarm('FeedbackLatencyAlarm', props.feedbackIngestFunction, 'Feedback Ingest');

    const dbConnectionAlarm = new cloudwatch.Alarm(this, 'DatabaseConnectionsAlarm', {
      metric: dbConnections,
      threshold: dbConnectionThreshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: `Database connections above ${dbConnectionThreshold}`,
    });
    dbConnectionAlarm.addAlarmAction(...alarmActions);

    const dlqAlarm = new cloudwatch.Alarm(this, 'ContentDlqAlarm', {
      metric: props.contentDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: dlqThreshold,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: `Messages detected in content processing DLQ (>= ${dlqThreshold})`,
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
      region: billingRegion,
    });

    const costAlarm = new cloudwatch.Alarm(this, 'DailyCostAlarm', {
      metric: costMetric,
      threshold: dailyCostThreshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: `Estimated daily AWS spend exceeded $${dailyCostThreshold}`,
    });
    costAlarm.addAlarmAction(...alarmActions);

    const syntheticNamespace = `CommunityContentHub/Synthetic/${envName}`;
    const syntheticFunction = new NodejsFunction(this, 'SyntheticHealthCheckFunction', {
      functionName: `community-content-tracker-${envName}-synthetic`,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(lambdaEntryPath, 'monitoring/synthetic-check.ts'),
      handler: 'handler',
      depsLockFilePath,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        SYNTHETIC_URL: syntheticUrl,
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
      threshold: syntheticAvailabilityThreshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: `Synthetic monitoring detected availability below ${syntheticAvailabilityThreshold}%`,
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
