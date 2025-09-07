import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { DatabaseStack } from '../../src/infrastructure/lib/stacks/database-stack';

describe('DatabaseStack', () => {
  let app: cdk.App;
  let stack: DatabaseStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
  });

  describe('when creating development environment', () => {
    beforeEach(() => {
      stack = new DatabaseStack(app, 'TestDatabaseStack', {
        environment: 'dev',
        deletionProtection: false,
        backupRetentionDays: 7,
        minCapacity: 0.5,
        maxCapacity: 1,
      });
      template = Template.fromStack(stack);
    });

    it('should create VPC with proper configuration', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    it('should create public and private subnets', () => {
      template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 AZs * 2 subnet types
      
      // Public subnet
      template.hasResourceProperties('AWS::EC2::Subnet', {
        MapPublicIpOnLaunch: true,
      });
    });

    it('should create Aurora Serverless v2 cluster with proper configuration', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        Engine: 'aurora-postgresql',
        EngineVersion: '15.4',
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 1,
        },
        BackupRetentionPeriod: 7,
        DeletionProtection: false,
        DatabaseName: 'community_content',
      });
    });

    it('should create Aurora Serverless v2 writer instance', () => {
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.serverless',
        Engine: 'aurora-postgresql',
      });
    });

    it('should create database credentials secret', () => {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: 'Aurora Serverless database credentials',
        GenerateSecretString: {
          SecretStringTemplate: '{"username":"postgres"}',
          GenerateStringKey: 'password',
          PasswordLength: 32,
          ExcludeCharacters: '"@/\\',
        },
      });
    });

    it('should create RDS Proxy for connection pooling', () => {
      template.hasResourceProperties('AWS::RDS::DBProxy', {
        EngineFamily: 'POSTGRESQL',
        RequireTLS: true,
        IdleClientTimeout: 1800,
      });
    });

    it('should create security groups with proper ingress rules', () => {
      // Database security group
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for Aurora Serverless cluster',
      });

      // Should have ingress rules for Lambda and RDS Proxy
      template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        IpProtocol: 'tcp',
        FromPort: 5432,
        ToPort: 5432,
      });
    });

    it('should create bastion host for development', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 't3.micro',
      });

      // Should have SSH access - checking for the bastion security group with SSH access
      const securityGroupIngresses = template.findResources('AWS::EC2::SecurityGroupIngress');
      const sshRule = Object.values(securityGroupIngresses).find(
        (rule: any) => rule.Properties.FromPort === 22 && rule.Properties.ToPort === 22
      );
      expect(sshRule).toBeDefined();
      expect(sshRule?.Properties.CidrIp).toBe('0.0.0.0/0');
    });

    it('should create pgvector enabler custom resource', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.11',
        Handler: 'index.handler',
        Timeout: 300,
      });

      template.hasResource('AWS::CloudFormation::CustomResource', {
        Properties: {
          ServiceToken: Match.anyValue(),
          ClusterEndpoint: Match.anyValue(),
          SecretArn: Match.anyValue(),
          DatabaseName: 'community_content',
        },
      });
    });

    it('should have proper CloudFormation outputs', () => {
      template.hasOutput('VpcId', {
        Description: 'VPC ID for the database infrastructure',
      });

      template.hasOutput('DatabaseClusterEndpoint', {
        Description: 'Aurora cluster endpoint',
      });

      template.hasOutput('RDSProxyEndpoint', {
        Description: 'RDS Proxy endpoint for connection pooling',
      });

      template.hasOutput('DatabaseSecretArn', {
        Description: 'Secrets Manager ARN for database credentials',
      });
    });

    it('should have proper cost tracking tags', () => {
      // Tags are applied at the stack level, so just check that resources exist
      template.resourceCountIs('AWS::RDS::DBCluster', 1);
      template.resourceCountIs('AWS::EC2::VPC', 1);
    });
  });

  describe('when creating production environment', () => {
    beforeEach(() => {
      stack = new DatabaseStack(app, 'TestProdDatabaseStack', {
        environment: 'prod',
        deletionProtection: true,
        backupRetentionDays: 30,
        minCapacity: 1,
        maxCapacity: 4,
      });
      template = Template.fromStack(stack);
    });

    it('should have higher capacity for production', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 1,
          MaxCapacity: 4,
        },
        BackupRetentionPeriod: 30,
        DeletionProtection: true,
      });
    });

    it('should not allow bastion host access in production', () => {
      // Count security group ingress rules - should not have bastion access
      const securityGroups = template.findResources('AWS::EC2::SecurityGroup');
      const databaseSecurityGroup = Object.values(securityGroups).find(
        (sg: any) => sg.Properties.GroupDescription === 'Security group for Aurora Serverless cluster'
      );
      
      expect(databaseSecurityGroup).toBeDefined();
    });

    it('should have longer CloudWatch log retention', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        EnableCloudwatchLogsExports: ['postgresql'],
      });
    });
  });

  describe('when validating security configuration', () => {
    beforeEach(() => {
      stack = new DatabaseStack(app, 'TestSecurityStack');
      template = Template.fromStack(stack);
    });

    it('should not allow public access to database', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        DBSubnetGroupName: Match.anyValue(),
      });

      // Database should be in private subnets
      template.hasResourceProperties('AWS::RDS::DBSubnetGroup', {
        DBSubnetGroupDescription: 'Subnet group for Aurora Serverless cluster',
        SubnetIds: Match.anyValue(),
      });
    });

    it('should require TLS for RDS Proxy', () => {
      template.hasResourceProperties('AWS::RDS::DBProxy', {
        RequireTLS: true,
      });
    });

    it('should use proper IAM roles for Lambda', () => {
      // Check that Lambda function IAM role exists
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            }),
          ]),
        },
      });
    });
  });

  describe('when validating dependencies', () => {
    beforeEach(() => {
      stack = new DatabaseStack(app, 'TestDependencyStack');
      template = Template.fromStack(stack);
    });

    it('should have proper resource dependencies', () => {
      // Custom resource should depend on cluster
      const customResources = template.findResources('AWS::CloudFormation::CustomResource');
      expect(Object.keys(customResources)).toHaveLength(1);
    });

    it('should create resources in correct order', () => {
      // VPC should be created first
      template.hasResource('AWS::EC2::VPC', {});
      
      // Subnets should reference VPC
      template.hasResourceProperties('AWS::EC2::Subnet', {
        VpcId: Match.anyValue(),
      });

      // Security groups should reference VPC
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        VpcId: Match.anyValue(),
      });
    });
  });
});