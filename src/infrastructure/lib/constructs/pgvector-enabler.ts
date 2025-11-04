import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface PgVectorEnablerProps {
  /**
   * The Aurora cluster to enable pgvector on
   */
  cluster: rds.IDatabaseCluster;

  /**
   * The secret containing database credentials
   */
  databaseSecret: secretsmanager.ISecret;

  /**
   * The VPC where the Lambda function will run
   */
  vpc: ec2.IVpc;

  /**
   * Security groups for the Lambda function
   */
  securityGroups: ec2.ISecurityGroup[];

  /**
   * Database name to connect to
   */
  databaseName?: string;
}

/**
 * Custom construct to enable pgvector extension in Aurora Serverless PostgreSQL
 * 
 * This construct creates a Lambda function that connects to the database
 * and enables the pgvector extension, which is required for vector similarity search.
 */
export class PgVectorEnabler extends Construct {
  public readonly customResource: cdk.CustomResource;
  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: PgVectorEnablerProps) {
    super(scope, id);

    // Create IAM role for Lambda function
    const lambdaRole = new iam.Role(this, 'PgVectorLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant access to read the database secret
    props.databaseSecret.grantRead(lambdaRole);

    // Grant RDS connect permission
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['rds-db:connect'],
      resources: [
        `arn:aws:rds-db:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:dbuser:${props.cluster.clusterIdentifier}/*`,
      ],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'rds-data:ExecuteStatement',
        'rds-data:BatchExecuteStatement',
        'rds-data:BeginTransaction',
        'rds-data:CommitTransaction',
        'rds-data:RollbackTransaction',
      ],
      resources: [props.cluster.clusterArn],
    }));

    // Create Lambda function that will enable pgvector
    this.lambdaFunction = new lambda.Function(this, 'PgVectorEnablerFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      securityGroups: props.securityGroups,
      environment: {
        CLUSTER_ARN: props.cluster.clusterArn,
        SECRET_ARN: props.databaseSecret.secretArn,
        DATABASE_NAME: props.databaseName || 'postgres',
        CLUSTER_IDENTIFIER: props.cluster.clusterIdentifier,
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
import os
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

rds_data = boto3.client('rds-data')

def handler(event, context):
    """
    Lambda function to enable pgvector extension in Aurora PostgreSQL
    """
    logger.info(f"Received event: {json.dumps(event)}")

    request_type = event['RequestType']

    try:
        if request_type in ['Create', 'Update']:
            enable_pgvector()
            response_data = {'Status': 'SUCCESS', 'Message': 'pgvector extension ensured'}
        elif request_type == 'Delete':
            # Don't disable pgvector on delete to avoid breaking existing data
            response_data = {'Status': 'SUCCESS', 'Message': 'Delete operation - no action taken'}
        else:
            raise ValueError(f"Unknown request type: {request_type}")

        send_response(event, context, 'SUCCESS', response_data)

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        send_response(event, context, 'FAILED', {'Message': str(e)})

def enable_pgvector():
    """Ensure the pgvector extension exists by executing CREATE EXTENSION."""
    try:
        sql = 'CREATE EXTENSION IF NOT EXISTS vector;'
        logger.info('Executing statement to enable pgvector extension')
        response = rds_data.execute_statement(
            resourceArn=os.environ['CLUSTER_ARN'],
            secretArn=os.environ['SECRET_ARN'],
            database=os.environ['DATABASE_NAME'],
            sql=sql
        )
        logger.info('pgvector extension command executed: %s', response)
    except ClientError as error:
        if error.response['Error']['Code'] == 'BadRequestException' and 'vector' in error.response['Error'].get('Message', '').lower():
            logger.info('pgvector extension already available: %s', error.response['Error']['Message'])
        else:
            logger.error('Failed to create pgvector extension: %s', error)
            raise

def send_response(event, context, response_status, response_data):
    """Send response back to CloudFormation"""
    import urllib3
    
    http = urllib3.PoolManager()
    
    response_body = {
        'Status': response_status,
        'Reason': response_data.get('Message', 'See CloudWatch logs for details'),
        'PhysicalResourceId': context.log_group_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        response = http.request('PUT', event['ResponseURL'], 
                              body=json_response_body, headers=headers)
        logger.info(f"CloudFormation response sent: {response.status}")
    except Exception as e:
        logger.error(f"Failed to send response to CloudFormation: {e}")
`),
    });

    // Create custom resource provider
    const provider = new cr.Provider(this, 'PgVectorProvider', {
      onEventHandler: this.lambdaFunction,
    });

    // Create the custom resource
    this.customResource = new cdk.CustomResource(this, 'PgVectorResource', {
      serviceToken: provider.serviceToken,
      properties: {
        ClusterEndpoint: props.cluster.clusterEndpoint.socketAddress,
        SecretArn: props.databaseSecret.secretArn,
        DatabaseName: props.databaseName || 'postgres',
        // Add timestamp to force updates when needed
        Timestamp: Date.now().toString(),
      },
    });

    // Ensure custom resource runs after cluster is available
    this.customResource.node.addDependency(props.cluster);
  }
}
