import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../../src/infrastructure/lib/stacks/database-stack';

/**
 * Tests for Task 1.4: Aurora Serverless Database Setup
 * 
 * Requirements from Sprint 1:
 * - Aurora Serverless v2 Postgres cluster deployed
 * - pgvector extension enabled via custom resource
 * - Database secrets stored in Secrets Manager
 * - VPC and security groups properly configured
 * - Database proxy configured for connection pooling
 * - Dev database accessible via bastion host for debugging
 * - Automated backup configuration with 7-day retention
 * - Point-in-time recovery enabled
 */
describe('DatabaseStack - Sprint 1 Requirements', () => {
  let app: App;
  let stack: DatabaseStack;
  let template: Template;

  describe('Task 1.4: Aurora Serverless Database Setup', () => {
    beforeEach(() => {
      app = new App();
      stack = new DatabaseStack(app, 'TestDatabaseStack', {
        environment: 'dev',
        deletionProtection: false,
        backupRetentionDays: 7, // Sprint 1 requires 7-day retention
        minCapacity: 0.5,
        maxCapacity: 1,
      });
      template = Template.fromStack(stack);
    });

    it('should deploy Aurora Serverless v2 Postgres cluster', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        Engine: 'aurora-postgresql',
        ServerlessV2ScalingConfiguration: Match.objectLike({
          MinCapacity: Match.anyValue(),
          MaxCapacity: Match.anyValue(),
        }),
      });
    });

    it('should enable pgvector extension via custom resource', () => {
      // Verify custom resource exists
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        ServiceToken: Match.anyValue(),
      });

      // Verify Lambda function for enabling pgvector
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: Match.anyValue(),
        Runtime: Match.stringLikeRegexp('python'),
      });
    });

    it('should store database secrets in Secrets Manager', () => {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: Match.anyValue(),
        GenerateSecretString: Match.objectLike({
          GenerateStringKey: 'password',
        }),
      });

      // Verify secret is attached to cluster
      template.hasResourceProperties('AWS::SecretsManager::SecretTargetAttachment', {
        TargetType: 'AWS::RDS::DBCluster',
      });
    });

    it('should configure VPC and security groups properly', () => {
      // VPC configuration
      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });

      // Security group for database
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: Match.stringLikeRegexp('.*[Dd]atabase.*'),
      });

      // Verify subnets exist
      const json = template.toJSON();
      const subnets = Object.keys(json.Resources).filter(key => 
        json.Resources[key].Type === 'AWS::EC2::Subnet'
      );
      expect(subnets.length).toBeGreaterThanOrEqual(2); // At least 2 subnets for HA
    });

    it('should configure database proxy for connection pooling', () => {
      template.hasResourceProperties('AWS::RDS::DBProxy', {
        DBProxyName: Match.anyValue(),
        EngineFamily: 'POSTGRESQL',
        RequireTLS: true,
        Auth: Match.arrayWith([
          Match.objectLike({
            AuthScheme: 'SECRETS',
          }),
        ]),
      });

      // Verify proxy target group
      template.hasResourceProperties('AWS::RDS::DBProxyTargetGroup', {
        DBProxyName: Match.anyValue(),
        TargetGroupName: 'default',
      });
    });

    it('should make dev database accessible via bastion host for debugging', () => {
      // For dev environment, bastion host should be created
      const json = template.toJSON();
      const bastionResources = Object.keys(json.Resources).filter(key => 
        key.includes('Bastion')
      );
      expect(bastionResources.length).toBeGreaterThan(0);

      // Verify bastion security group exists
      const bastionSecurityGroups = Object.keys(json.Resources).filter(key => 
        key.includes('BastionSecurityGroup')
      );
      expect(bastionSecurityGroups.length).toBeGreaterThan(0);
    });

    it('should configure automated backup with 7-day retention', () => {
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        BackupRetentionPeriod: 7,
        PreferredBackupWindow: Match.anyValue(),
        PreferredMaintenanceWindow: Match.anyValue(),
      });
    });

    it('should enable point-in-time recovery', () => {
      // Point-in-time recovery is enabled when BackupRetentionPeriod > 0
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        BackupRetentionPeriod: Match.anyValue(),
      });

      // Verify the backup retention is greater than 0 (which enables PITR)
      const json = template.toJSON();
      const cluster = Object.values(json.Resources).find(
        (r: any) => r.Type === 'AWS::RDS::DBCluster'
      ) as any;
      expect(cluster.Properties.BackupRetentionPeriod).toBeGreaterThan(0);
    });
  });

  describe('Task 1.2: CDK Infrastructure Bootstrap - Database Stack', () => {
    beforeEach(() => {
      app = new App();
      stack = new DatabaseStack(app, 'TestDatabaseStack', {
        environment: 'dev',
      });
      template = Template.fromStack(stack);
    });

    it('should configure cost tags for all resources', () => {
      // Verify stack-level tags are applied
      expect(stack.tags.tagValues()).toMatchObject({
        Environment: 'dev',
        Project: 'community-content-hub',
      });
    });

    it('should support environment configuration (dev/staging/prod)', () => {
      // Create separate apps for each environment to avoid synthesis conflicts
      
      // Test dev configuration
      const devApp = new App();
      const devStack = new DatabaseStack(devApp, 'DevStack', {
        environment: 'dev',
      });
      // Verify tags are applied to resources
      const devTemplate = Template.fromStack(devStack);
      devTemplate.hasResourceProperties('AWS::EC2::VPC', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'Environment', Value: 'dev' }),
        ]),
      });

      // Test staging configuration
      const stagingApp = new App();
      const stagingStack = new DatabaseStack(stagingApp, 'StagingStack', {
        environment: 'staging',
      });
      const stagingTemplate = Template.fromStack(stagingStack);
      stagingTemplate.hasResourceProperties('AWS::EC2::VPC', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'Environment', Value: 'staging' }),
        ]),
      });

      // Test prod configuration
      const prodApp = new App();
      const prodStack = new DatabaseStack(prodApp, 'ProdStack', {
        environment: 'prod',
      });
      const prodTemplate = Template.fromStack(prodStack);
      prodTemplate.hasResourceProperties('AWS::EC2::VPC', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'Environment', Value: 'prod' }),
        ]),
      });
    });

    it('should create basic parameter store setup for configuration', () => {
      // Verify SSM parameters are created for database configuration
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Type: 'String',
        Name: Match.stringLikeRegexp('.*database.*'),
      });

      // Should create parameters for database endpoint
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: Match.stringLikeRegexp('.*endpoint.*'),
        Type: 'String',
      });

      // Should create parameters for database proxy endpoint
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: Match.stringLikeRegexp('.*proxy.*'),
        Type: 'String',
      });
    });
  });

  describe('Production environment differences', () => {
    beforeEach(() => {
      app = new App();
      stack = new DatabaseStack(app, 'ProdDatabaseStack', {
        environment: 'prod',
        deletionProtection: true,
        backupRetentionDays: 30,
        minCapacity: 2,
        maxCapacity: 16,
      });
      template = Template.fromStack(stack);
    });

    it('should NOT create bastion host for production', () => {
      // Bastion host should only be in dev, not prod
      const json = template.toJSON();
      const bastionResources = Object.keys(json.Resources).filter(key => 
        key.toLowerCase().includes('bastion')
      );
      expect(bastionResources.length).toBe(0);
    });
  });
});