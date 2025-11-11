import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PublicApiStack } from '../../src/infrastructure/lib/stacks/PublicApiStack';

const mockSecretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-secret';

describe('PublicApiStack', () => {
  it('configures provisioned concurrency and auto scaling in production environments', () => {
    const app = new cdk.App();
    const stack = new PublicApiStack(app, 'PublicApiProd', {
      environment: 'prod',
      databaseSecretArn: mockSecretArn,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'prod-live',
      ProvisionedConcurrencyConfig: {
        ProvisionedConcurrentExecutions: 5,
      },
    });

    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 5,
      MaxCapacity: 30,
    });

    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', Match.objectLike({
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        TargetValue: 0.75,
      }),
    }));
  });

  it('omits alias-based scaling for development environments', () => {
    const app = new cdk.App();
    const stack = new PublicApiStack(app, 'PublicApiDev', {
      environment: 'dev',
      databaseSecretArn: mockSecretArn,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Alias', 0);
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});
