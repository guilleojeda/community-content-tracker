import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseStack } from './stacks/database-stack';

export class InfrastructureStack extends cdk.Stack {
  public readonly database: DatabaseStack;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || process.env.ENVIRONMENT;
    if (!environment || environment.trim().length === 0) {
      throw new Error('Environment must be provided via CDK context (environment) or ENVIRONMENT env var');
    }

    const databaseName = this.node.tryGetContext('databaseName') || process.env.DATABASE_NAME;
    if (!databaseName || databaseName.trim().length === 0) {
      throw new Error('DATABASE_NAME must be provided via CDK context (databaseName) or env var');
    }

    // Create database stack
    this.database = new DatabaseStack(this, 'Database', {
      ...props,
      environment,
      databaseName,
    });
  }
}
