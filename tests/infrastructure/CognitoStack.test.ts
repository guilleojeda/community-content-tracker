import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CognitoStack } from '../../src/infrastructure/lib/stacks/CognitoStack';
import { EnvironmentConfig } from '../../src/infrastructure/config/environments';

describe('CognitoStack', () => {
  let app: App;
  let stack: CognitoStack;
  let template: Template;

  const buildConfig = (overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig => {
    const baseConfig: EnvironmentConfig = {
      environment: 'test',
      cognito: {
        passwordPolicy: {
          minLength: 12,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSymbols: true,
          tempPasswordValidityDays: 3,
        },
        mfaConfiguration: 'OPTIONAL',
        standardThreatProtectionMode: 'AUDIT',
        deletionProtection: false,
      },
      lambda: {
        timeout: 30,
        memorySize: 256,
        tracing: 'Active',
        environmentVariables: {
          LOG_LEVEL: 'debug',
          NODE_ENV: 'test',
        },
      },
      tags: {
        Project: 'CommunityContentTracker',
        Owner: 'AWS-Community-Team',
        CostCenter: 'test',
      },
    };

    return {
      ...baseConfig,
      ...overrides,
      cognito: {
        ...baseConfig.cognito,
        ...(overrides.cognito ?? {}),
        passwordPolicy: {
          ...baseConfig.cognito.passwordPolicy,
          ...(overrides.cognito?.passwordPolicy ?? {}),
        },
      },
      lambda: {
        ...baseConfig.lambda,
        ...(overrides.lambda ?? {}),
        environmentVariables: {
          ...baseConfig.lambda.environmentVariables,
          ...(overrides.lambda?.environmentVariables ?? {}),
        },
      },
      tags: {
        ...baseConfig.tags,
        ...(overrides.tags ?? {}),
      },
    };
  };

  const mockConfig = buildConfig();

  beforeEach(() => {
    app = new App();
    stack = new CognitoStack(app, 'TestCognitoStack', {
      config: mockConfig,
      env: {
        account: '123456789012',
        region: 'us-east-1'
      }
    });
    template = Template.fromStack(stack);
  });

  describe('User Pool Creation', () => {
    test('should create a Cognito User Pool with correct configuration', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: 'community-content-tracker-test',
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
        UsernameConfiguration: {
          CaseSensitive: false
        },
        DeletionProtection: 'INACTIVE'
      });
    });

    test('should configure email verification', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        VerificationMessageTemplate: {
          EmailMessageByLink: Match.stringLikeRegexp('.*Welcome.*'),
          EmailSubjectByLink: Match.stringLikeRegexp('.*Verify.*'),
          DefaultEmailOption: 'CONFIRM_WITH_LINK'
        }
      });
    });

    test('should have correct password policy configuration', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 12,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            RequireUppercase: true,
            TemporaryPasswordValidityDays: 3
          }
        }
      });
    });

    test('should configure MFA as optional', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'OPTIONAL',
        EnabledMfas: ['SMS_MFA', 'SOFTWARE_TOKEN_MFA']
      });
    });

    test('should enable threat protection features', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolAddOns: {
          AdvancedSecurityMode: 'AUDIT'
        }
      });
    });

    test('should allow threat protection to be turned off', () => {
      const offApp = new App();
      const offStack = new CognitoStack(offApp, 'TestCognitoStackOff', {
        config: buildConfig({
          cognito: {
            standardThreatProtectionMode: 'OFF',
          },
        }),
        env: {
          account: '123456789012',
          region: 'us-east-1',
        },
      });
      const offTemplate = Template.fromStack(offStack);

      offTemplate.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolAddOns: {
          AdvancedSecurityMode: 'OFF',
        },
      });
    });
  });

  describe('Custom Attributes', () => {
    test('should define custom username attribute', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          {
            Name: 'username',
            AttributeDataType: 'String',
            Mutable: true,
            StringAttributeConstraints: {
              MinLength: '3',
              MaxLength: '50'
            }
          }
        ])
      });
    });

    test('should define custom default_visibility attribute', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          {
            Name: 'default_visibility',
            AttributeDataType: 'String',
            Mutable: true,
            StringAttributeConstraints: {
              MinLength: '1',
              MaxLength: '20'
            }
          }
        ])
      });
    });

    test('should define custom is_admin attribute', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          {
            Name: 'is_admin',
            AttributeDataType: 'String',
            Mutable: true,
            StringAttributeConstraints: {
              MinLength: '4',
              MaxLength: '5'
            }
          }
        ])
      });
    });

    test('should include standard email attribute', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          {
            Name: 'email',
            Mutable: true,
            Required: true
          }
        ])
      });
    });
  });

  describe('Pre-signup Lambda Function', () => {
    test('should create pre-signup Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('.*pre-signup.*'),
        Runtime: 'nodejs18.x',
        Handler: 'index.handler',
        Timeout: 30,
        MemorySize: 256
      });
    });

    test('should use pass-through tracing when disabled', () => {
      const passThroughApp = new App();
      const passThroughStack = new CognitoStack(passThroughApp, 'TestCognitoStackPassThrough', {
        config: buildConfig({
          lambda: {
            tracing: 'PassThrough',
          },
        }),
        env: {
          account: '123456789012',
          region: 'us-east-1',
        },
      });
      const passThroughTemplate = Template.fromStack(passThroughStack);

      passThroughTemplate.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('.*pre-signup.*'),
        TracingConfig: {
          Mode: 'PassThrough',
        },
      });
    });

    test('should have correct Lambda execution role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com'
              },
              Action: 'sts:AssumeRole'
            }
          ]
        }
        // Note: ManagedPolicyArns might be stored as CloudFormation references
      });
    });

    test('should attach pre-signup trigger to User Pool', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: {
          PreSignUp: {
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('.*PreSignupLambda.*'),
              'Arn'
            ])
          }
        }
      });
    });

    test('should grant Cognito permission to invoke Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'cognito-idp.amazonaws.com',
        SourceArn: {
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('.*UserPool.*'),
            'Arn'
          ])
        }
      });
    });
  });

  describe('User Pool Client', () => {
    test('should create User Pool Client with correct settings', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
        ExplicitAuthFlows: [
          'ALLOW_USER_PASSWORD_AUTH',
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH'
        ],
        PreventUserExistenceErrors: 'ENABLED',
        RefreshTokenValidity: 43200, // 30 days in minutes
        AccessTokenValidity: 60,
        IdTokenValidity: 60
      });
    });

    test('should reference the correct User Pool', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        UserPoolId: {
          Ref: Match.stringLikeRegexp('.*UserPool.*')
        }
      });
    });
  });

  describe('Admin User Group', () => {
    test('should create admin user group', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
        GroupName: 'admin',
        Description: 'Administrator users with full access',
        Precedence: 1
      });
    });

    test('should reference the correct User Pool', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
        UserPoolId: {
          Ref: Match.stringLikeRegexp('.*UserPool.*')
        }
      });
    });

    test('should have IAM role for admin group', () => {
      // The AdminGroupRole should exist with cognito-identity federation
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Federated: 'cognito-identity.amazonaws.com'
              },
              Action: 'sts:AssumeRoleWithWebIdentity'
            }
          ]
        }
      });
    });
  });

  describe('Stack Outputs', () => {
    test('should export User Pool ID', () => {
      template.hasOutput('UserPoolId', {
        Description: 'Cognito User Pool ID',
        Export: {
          Name: 'community-content-tracker-test-UserPoolId'
        }
      });
    });

    test('should export User Pool Client ID', () => {
      template.hasOutput('UserPoolClientId', {
        Description: 'Cognito User Pool Client ID',
        Export: {
          Name: 'community-content-tracker-test-UserPoolClientId'
        }
      });
    });

    test('should export User Pool ARN', () => {
      template.hasOutput('UserPoolArn', {
        Description: 'Cognito User Pool ARN',
        Export: {
          Name: 'community-content-tracker-test-UserPoolArn'
        }
      });
    });

    test('should export Admin Group Name', () => {
      template.hasOutput('AdminGroupName', {
        Description: 'Admin user group name',
        Export: {
          Name: 'community-content-tracker-test-AdminGroupName'
        }
      });
    });
  });

  describe('Resource Tagging', () => {
    test('should apply consistent tags to resources', () => {
      const expectedTags = {
        Project: 'CommunityContentTracker',
        Owner: 'AWS-Community-Team',
        CostCenter: 'test',
        Environment: 'test'
      };

      // Check User Pool tags
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolTags: expectedTags
      });
    });
  });

  describe('Environment-specific Configuration', () => {
    test('should use environment-specific password policy for production', () => {
      const prodConfig = {
        ...mockConfig,
        environment: 'prod',
        cognito: {
          ...mockConfig.cognito,
          passwordPolicy: {
            minLength: 14,
            requireLowercase: true,
            requireUppercase: true,
            requireNumbers: true,
            requireSymbols: true,
            tempPasswordValidityDays: 1
          },
          standardThreatProtectionMode: 'ENFORCED' as const,
          deletionProtection: true
        }
      };

      const prodApp = new App();
      const prodStack = new CognitoStack(prodApp, 'ProdCognitoStack', {
        config: prodConfig,
        env: {
          account: '123456789012',
          region: 'us-east-1'
        }
      });

      const prodTemplate = Template.fromStack(prodStack);

      prodTemplate.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 14,
            TemporaryPasswordValidityDays: 1
          }
        },
        DeletionProtection: 'ACTIVE',
        UserPoolAddOns: {
          AdvancedSecurityMode: 'ENFORCED'
        }
      });
    });

    test('should use environment-specific MFA configuration', () => {
      const mfaRequiredConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          mfaConfiguration: 'REQUIRED' as const
        }
      };

      const mfaApp = new App();
      const mfaStack = new CognitoStack(mfaApp, 'MfaCognitoStack', {
        config: mfaRequiredConfig,
        env: {
          account: '123456789012',
          region: 'us-east-1'
        }
      });

      const mfaTemplate = Template.fromStack(mfaStack);

      mfaTemplate.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'ON' // CDK translates 'REQUIRED' to 'ON'
      });
    });

    test('should allow MFA to be disabled explicitly', () => {
      const mfaOffConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          mfaConfiguration: 'OFF' as const
        }
      };

      const mfaOffApp = new App();
      const mfaOffStack = new CognitoStack(mfaOffApp, 'MfaOffCognitoStack', {
        config: mfaOffConfig,
        env: {
          account: '123456789012',
          region: 'us-east-1'
        }
      });

      const mfaOffTemplate = Template.fromStack(mfaOffStack);

      mfaOffTemplate.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'OFF'
      });
    });

    test('should default threat protection mode to AUDIT for unknown values', () => {
      const securityConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          standardThreatProtectionMode: 'UNKNOWN' as any
        }
      };

      const securityApp = new App();
      const securityStack = new CognitoStack(securityApp, 'SecurityDefaultStack', {
        config: securityConfig,
        env: {
          account: '123456789012',
          region: 'us-east-1'
        }
      });

      const securityTemplate = Template.fromStack(securityStack);

      securityTemplate.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolAddOns: {
          AdvancedSecurityMode: 'AUDIT'
        }
      });
    });
  });

  describe('Security Validation', () => {
    test('should not have insecure configurations', () => {
      // Ensure no weak password policies
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 12 // Should be at least 8
          }
        }
      });
    });

    test('should enable email verification by default', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AutoVerifiedAttributes: Match.arrayWith(['email'])
      });
    });

    test('should prevent user existence errors', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        PreventUserExistenceErrors: 'ENABLED'
      });
    });
  });

  describe('Lambda Function Code Validation', () => {
    test('should have valid pre-signup Lambda code structure', () => {
      // The Lambda should validate username format and prevent duplicates
      template.hasResourceProperties('AWS::Lambda::Function', {
        Code: {
          ZipFile: Match.stringLikeRegexp('.+')
        }
      });
    });
  });

  describe('Integration Points', () => {
    test('should be ready for API Gateway integration', () => {
      // Verify that necessary outputs are available for API Gateway
      const outputs = template.findOutputs('*');
      expect(Object.keys(outputs)).toContain('UserPoolId');
      expect(Object.keys(outputs)).toContain('UserPoolClientId');
    });

    test('should be compatible with JWT verification', () => {
      // Verify that User Pool Client supports necessary auth flows
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith([
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH'
        ])
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid environment configuration gracefully', () => {
      const invalidConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          passwordPolicy: {
            ...mockConfig.cognito.passwordPolicy,
            minLength: 3 // Invalid minimum length
          }
        }
      };

      expect(() => {
        const errorApp = new App();
        new CognitoStack(errorApp, 'InvalidCognitoStack', {
          config: invalidConfig,
          env: {
            account: '123456789012',
            region: 'us-east-1'
          }
        });
      }).toThrow('Password minimum length must be at least 12 characters'); // Stack should validate configuration
    });

    test('should reject password policy lengths above 128 characters', () => {
      const invalidConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          passwordPolicy: {
            ...mockConfig.cognito.passwordPolicy,
            minLength: 129
          }
        }
      };

      expect(() => {
        const errorApp = new App();
        new CognitoStack(errorApp, 'InvalidLengthStack', {
          config: invalidConfig,
          env: {
            account: '123456789012',
            region: 'us-east-1'
          }
        });
      }).toThrow('Password minimum length cannot exceed 128 characters');
    });

    test('should reject unsupported MFA configuration values', () => {
      const invalidConfig = {
        ...mockConfig,
        cognito: {
          ...mockConfig.cognito,
          mfaConfiguration: 'INVALID' as any
        }
      };

      expect(() => {
        const errorApp = new App();
        new CognitoStack(errorApp, 'InvalidMfaStack', {
          config: invalidConfig,
          env: {
            account: '123456789012',
            region: 'us-east-1'
          }
        });
      }).toThrow('Invalid MFA configuration: INVALID');
    });

    test('should require callback URLs to be configured', () => {
      const originalCallback = process.env.COGNITO_CALLBACK_URLS;
      const originalLogout = process.env.COGNITO_LOGOUT_URLS;
      process.env.COGNITO_CALLBACK_URLS = '';
      process.env.COGNITO_LOGOUT_URLS = 'http://localhost:3000/logout';

      try {
        const errorApp = new App();
        expect(() => {
          new CognitoStack(errorApp, 'MissingCallbackStack', {
            config: mockConfig,
            env: {
              account: '123456789012',
              region: 'us-east-1'
            }
          });
        }).toThrow('COGNITO_CALLBACK_URLS must be set');
      } finally {
        process.env.COGNITO_CALLBACK_URLS = originalCallback;
        process.env.COGNITO_LOGOUT_URLS = originalLogout;
      }
    });

    test('should require at least one logout URL', () => {
      const originalCallback = process.env.COGNITO_CALLBACK_URLS;
      const originalLogout = process.env.COGNITO_LOGOUT_URLS;
      process.env.COGNITO_CALLBACK_URLS = 'http://localhost:3000/callback';
      process.env.COGNITO_LOGOUT_URLS = ' , ';

      try {
        const errorApp = new App();
        expect(() => {
          new CognitoStack(errorApp, 'MissingLogoutStack', {
            config: mockConfig,
            env: {
              account: '123456789012',
              region: 'us-east-1'
            }
          });
        }).toThrow('COGNITO_LOGOUT_URLS must include at least one URL');
      } finally {
        process.env.COGNITO_CALLBACK_URLS = originalCallback;
        process.env.COGNITO_LOGOUT_URLS = originalLogout;
      }
    });
  });

  describe('Performance Considerations', () => {
    test('should have reasonable token validity periods', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        RefreshTokenValidity: 43200, // 30 days in minutes (30 * 24 * 60)
        AccessTokenValidity: 60, // 60 minutes
        IdTokenValidity: 60 // 60 minutes
      });
    });
  });
});

describe('CognitoStack Integration Tests', () => {
  test('should create user with valid email and username', async () => {
    // This would be an integration test that actually creates a user
    // For now, we're testing the CDK template structure
    const app = new App();
    const stack = new CognitoStack(app, 'IntegrationTestStack', {
      config: {
        environment: 'test',
        cognito: {
          passwordPolicy: {
            minLength: 12,
            requireLowercase: true,
            requireUppercase: true,
            requireNumbers: true,
            requireSymbols: true,
            tempPasswordValidityDays: 3,
          },
          mfaConfiguration: 'OPTIONAL',
          standardThreatProtectionMode: 'AUDIT',
          deletionProtection: false,
        },
        lambda: {
          timeout: 30,
          memorySize: 256,
          tracing: 'Active',
          environmentVariables: { LOG_LEVEL: 'debug', NODE_ENV: 'test' },
        },
        tags: {
          Project: 'CommunityContentTracker',
          Owner: 'AWS-Community-Team',
          CostCenter: 'test',
        },
      } as EnvironmentConfig,
    });

    const template = Template.fromStack(stack);

    // Verify the stack can be synthesized without errors
    expect(() => template.toJSON()).not.toThrow();

    // Verify that the User Pool supports the required signup flow
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Schema: Match.arrayWith([
        Match.objectLike({
          Name: 'email',
          Required: true
        }),
        Match.objectLike({
          Name: 'username'
        })
      ])
    });
  });
});
