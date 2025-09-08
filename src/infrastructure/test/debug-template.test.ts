import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';

describe('Debug Template Output', () => {
  it('should show StaticSiteStack template', () => {
    const app = new cdk.App();
    const stack = new StaticSiteStack(app, 'TestStack', {
      environment: 'dev',
      domainName: 'test.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
    });
    
    const template = Template.fromStack(stack);
    const json = template.toJSON();
    
    // Log the resources to see what's actually created
    console.log('Resources created:', Object.keys(json.Resources || {}).map(key => ({
      name: key,
      type: json.Resources[key].Type
    })));
    
    expect(json.Resources).toBeDefined();
  });

  it('should show DatabaseStack template', () => {
    const app = new cdk.App();
    const stack = new DatabaseStack(app, 'TestDbStack', {
      environment: 'dev',
      deletionProtection: false,
    });
    
    const template = Template.fromStack(stack);
    const json = template.toJSON();
    
    // Log the resources to see what's actually created
    console.log('Database Resources:', Object.keys(json.Resources || {}).map(key => ({
      name: key,
      type: json.Resources[key].Type
    })));
    
    expect(json.Resources).toBeDefined();
  });
});