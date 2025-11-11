import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';

import { ApplicationApiStack } from '../../src/infrastructure/lib/stacks/ApplicationApiStack';
import { getEnvironmentConfig } from '../../src/infrastructure/lib/config/environments';

describe('ApplicationApiStack', () => {
  it('schedules analytics data retention with the maintenance Lambda as target', () => {
    const app = new cdk.App();
    const authStack = new cdk.Stack(app, 'Auth');
    const userPool = new cognito.UserPool(authStack, 'UserPool');
    const userPoolClient = new cognito.UserPoolClient(authStack, 'UserPoolClient', {
      userPool,
    });

    const stack = new ApplicationApiStack(app, 'TestApplicationApiStack', {
      environment: 'dev',
      databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
      config: getEnvironmentConfig('dev'),
      userPool,
      userPoolClient,
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
