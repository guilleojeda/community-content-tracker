import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import { ApplicationApiStack } from '../../src/infrastructure/lib/stacks/ApplicationApiStack';
import { getEnvironmentConfig } from '../../src/infrastructure/lib/config/environments';

describe('ApplicationApiStack', () => {
  it('schedules analytics data retention with the maintenance Lambda as target', () => {
    const app = new cdk.App();
    const authStack = new cdk.Stack(app, 'Auth');
    const networkStack = new cdk.Stack(app, 'Network');
    const userPool = new cognito.UserPool(authStack, 'UserPool');
    const userPoolClient = new cognito.UserPoolClient(authStack, 'UserPoolClient', {
      userPool,
    });
    const vpc = new ec2.Vpc(networkStack, 'Vpc', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'PrivateIsolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    const lambdaSecurityGroup = new ec2.SecurityGroup(networkStack, 'LambdaSg', { vpc });

    const stack = new ApplicationApiStack(app, 'TestApplicationApiStack', {
      environment: 'dev',
      databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
      databaseProxyEndpoint: 'proxy.dev.local',
      databaseName: 'community_content',
      databasePort: 5432,
      redisUrl: 'redis://cache.dev.local:6379',
      config: getEnvironmentConfig('dev'),
      userPool,
      userPoolClient,
      vpc,
      lambdaSecurityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'analytics-retention-dev',
      ScheduleExpression: Match.stringLikeRegexp('cron\\(0 2 .*\\)'),
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: {
            'Fn::GetAtt': [Match.stringLikeRegexp('DataRetentionFunction.*'), 'Arn'],
          },
        }),
      ]),
    });
  });
});
