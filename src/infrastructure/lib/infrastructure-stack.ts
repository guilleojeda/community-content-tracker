import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseStack } from './stacks/database-stack';

export class InfrastructureStack extends cdk.Stack {
  public readonly database: DatabaseStack;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create database stack
    this.database = new DatabaseStack(this, 'Database', {
      ...props,
      environment: this.node.tryGetContext('environment') || 'dev',
    });
  }
}
