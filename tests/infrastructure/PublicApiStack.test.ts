import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { PublicApiStack } from '../../src/infrastructure/lib/stacks/PublicApiStack';

const mockSecretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-secret';

describe('PublicApiStack', () => {
  it('configures provisioned concurrency and auto scaling in production environments', () => {
    const app = new cdk.App();
    const networkStack = new cdk.Stack(app, 'NetworkProd');
    const vpc = new ec2.Vpc(networkStack, 'VpcProd', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'PrivateIsolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    const lambdaSecurityGroup = new ec2.SecurityGroup(networkStack, 'LambdaSgProd', { vpc });
    const stack = new PublicApiStack(app, 'PublicApiProd', {
      environment: 'prod',
      databaseSecretArn: mockSecretArn,
      databaseProxyEndpoint: 'proxy.example.com',
      databaseName: 'community_content',
      databasePort: 5432,
      redisUrl: 'redis://cache.prod.local:6379',
      vpc,
      lambdaSecurityGroup,
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
    const networkStack = new cdk.Stack(app, 'NetworkDev');
    const vpc = new ec2.Vpc(networkStack, 'VpcDev', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'PrivateIsolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    const lambdaSecurityGroup = new ec2.SecurityGroup(networkStack, 'LambdaSgDev', { vpc });
    const stack = new PublicApiStack(app, 'PublicApiDev', {
      environment: 'dev',
      databaseSecretArn: mockSecretArn,
      databaseProxyEndpoint: 'proxy.dev.local',
      databaseName: 'community_content',
      databasePort: 5432,
      redisUrl: 'redis://cache.dev.local:6379',
      vpc,
      lambdaSecurityGroup,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Alias', 0);
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});
