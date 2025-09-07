export interface EnvironmentConfig {
  environment: string;
  aws: {
    account?: string;
    region: string;
  };
  database: {
    instanceType: string;
    allocatedStorage: number;
    maxAllocatedStorage: number;
    backupRetentionDays: number;
    multiAz: boolean;
    deletionProtection: boolean;
    performanceInsightsEnabled: boolean;
    monitoringIntervalSeconds: number;
  };
  cognito: {
    passwordPolicy: {
      minLength: number;
      requireLowercase: boolean;
      requireUppercase: boolean;
      requireNumbers: boolean;
      requireSymbols: boolean;
      tempPasswordValidityDays: number;
    };
    mfaConfiguration: 'OFF' | 'OPTIONAL' | 'REQUIRED';
    advancedSecurityMode: 'OFF' | 'AUDIT' | 'ENFORCED';
    deletionProtection: boolean;
  };
  apiGateway: {
    throttling: {
      rateLimit: number;
      burstLimit: number;
    };
    caching: {
      enabled: boolean;
      clusterSize?: string;
      ttlMinutes?: number;
    };
    logging: {
      level: 'OFF' | 'ERROR' | 'INFO';
      dataTrace: boolean;
      metricsEnabled: boolean;
      retentionDays: number;
    };
    wafEnabled: boolean;
    allowedOrigins: string[];
  };
  lambda: {
    runtime: string;
    timeout: number;
    memorySize: number;
    reservedConcurrency?: number;
    tracing: 'Active' | 'PassThrough';
    environmentVariables: {
      logLevel: string;
      nodeEnv: string;
    };
  };
  monitoring: {
    cloudWatchRetentionDays: number;
    enableXRay: boolean;
    enableDetailedMonitoring: boolean;
  };
  security: {
    enableVpcFlowLogs: boolean;
    encryptionAtRest: boolean;
    encryptionInTransit: boolean;
  };
  tags: {
    Project: string;
    Owner: string;
    CostCenter: string;
    BackupRequired: string;
    DataClassification: string;
  };
}

export const environments: Record<string, EnvironmentConfig> = {
  dev: {
    environment: 'dev',
    aws: {
      region: 'us-east-1'
    },
    database: {
      instanceType: 't3.micro',
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      backupRetentionDays: 1,
      multiAz: false,
      deletionProtection: false,
      performanceInsightsEnabled: false,
      monitoringIntervalSeconds: 0
    },
    cognito: {
      passwordPolicy: {
        minLength: 8, // Relaxed for development
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSymbols: false, // Relaxed for development
        tempPasswordValidityDays: 7
      },
      mfaConfiguration: 'OFF',
      advancedSecurityMode: 'AUDIT',
      deletionProtection: false
    },
    apiGateway: {
      throttling: {
        rateLimit: 100,
        burstLimit: 200
      },
      caching: {
        enabled: false
      },
      logging: {
        level: 'INFO',
        dataTrace: true,
        metricsEnabled: true,
        retentionDays: 7
      },
      wafEnabled: false,
      allowedOrigins: [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://dev-community-tracker.aws'
      ]
    },
    lambda: {
      runtime: 'nodejs18.x',
      timeout: 30,
      memorySize: 256,
      tracing: 'Active',
      environmentVariables: {
        logLevel: 'debug',
        nodeEnv: 'development'
      }
    },
    monitoring: {
      cloudWatchRetentionDays: 7,
      enableXRay: true,
      enableDetailedMonitoring: false
    },
    security: {
      enableVpcFlowLogs: false,
      encryptionAtRest: true,
      encryptionInTransit: true
    },
    tags: {
      Project: 'CommunityContentTracker',
      Owner: 'AWS-Community-Team',
      CostCenter: 'community-engagement-dev',
      BackupRequired: 'false',
      DataClassification: 'internal'
    }
  },

  staging: {
    environment: 'staging',
    aws: {
      region: 'us-east-1'
    },
    database: {
      instanceType: 't3.small',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      backupRetentionDays: 7,
      multiAz: false,
      deletionProtection: false,
      performanceInsightsEnabled: false,
      monitoringIntervalSeconds: 0
    },
    cognito: {
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSymbols: true,
        tempPasswordValidityDays: 3
      },
      mfaConfiguration: 'OPTIONAL',
      advancedSecurityMode: 'AUDIT',
      deletionProtection: false
    },
    apiGateway: {
      throttling: {
        rateLimit: 500,
        burstLimit: 1000
      },
      caching: {
        enabled: true,
        clusterSize: '0.5',
        ttlMinutes: 5
      },
      logging: {
        level: 'INFO',
        dataTrace: false,
        metricsEnabled: true,
        retentionDays: 14
      },
      wafEnabled: true,
      allowedOrigins: [
        'https://staging-community-tracker.aws'
      ]
    },
    lambda: {
      runtime: 'nodejs18.x',
      timeout: 30,
      memorySize: 512,
      reservedConcurrency: 50,
      tracing: 'Active',
      environmentVariables: {
        logLevel: 'info',
        nodeEnv: 'staging'
      }
    },
    monitoring: {
      cloudWatchRetentionDays: 14,
      enableXRay: true,
      enableDetailedMonitoring: true
    },
    security: {
      enableVpcFlowLogs: true,
      encryptionAtRest: true,
      encryptionInTransit: true
    },
    tags: {
      Project: 'CommunityContentTracker',
      Owner: 'AWS-Community-Team',
      CostCenter: 'community-engagement-staging',
      BackupRequired: 'true',
      DataClassification: 'internal'
    }
  },

  prod: {
    environment: 'prod',
    aws: {
      region: 'us-east-1'
    },
    database: {
      instanceType: 'r6g.large',
      allocatedStorage: 100,
      maxAllocatedStorage: 1000,
      backupRetentionDays: 30,
      multiAz: true,
      deletionProtection: true,
      performanceInsightsEnabled: true,
      monitoringIntervalSeconds: 60
    },
    cognito: {
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSymbols: true,
        tempPasswordValidityDays: 3
      },
      mfaConfiguration: 'OPTIONAL',
      advancedSecurityMode: 'ENFORCED',
      deletionProtection: true
    },
    apiGateway: {
      throttling: {
        rateLimit: 1000,
        burstLimit: 2000
      },
      caching: {
        enabled: true,
        clusterSize: '0.5',
        ttlMinutes: 5
      },
      logging: {
        level: 'INFO',
        dataTrace: false,
        metricsEnabled: true,
        retentionDays: 30
      },
      wafEnabled: true,
      allowedOrigins: [
        'https://community-tracker.aws'
      ]
    },
    lambda: {
      runtime: 'nodejs18.x',
      timeout: 30,
      memorySize: 512,
      reservedConcurrency: 100,
      tracing: 'Active',
      environmentVariables: {
        logLevel: 'info',
        nodeEnv: 'production'
      }
    },
    monitoring: {
      cloudWatchRetentionDays: 30,
      enableXRay: true,
      enableDetailedMonitoring: true
    },
    security: {
      enableVpcFlowLogs: true,
      encryptionAtRest: true,
      encryptionInTransit: true
    },
    tags: {
      Project: 'CommunityContentTracker',
      Owner: 'AWS-Community-Team',
      CostCenter: 'community-engagement',
      BackupRequired: 'true',
      DataClassification: 'confidential'
    }
  }
};

export function getEnvironmentConfig(environment: string): EnvironmentConfig {
  const config = environments[environment];
  if (!config) {
    throw new Error(`Unknown environment: ${environment}. Available environments: ${Object.keys(environments).join(', ')}`);
  }
  return config;
}

export function validateEnvironmentConfig(config: EnvironmentConfig): void {
  const errors: string[] = [];

  // Validate required fields
  if (!config.environment) errors.push('Environment name is required');
  if (!config.aws.region) errors.push('AWS region is required');
  
  // Validate database config
  if (config.database.allocatedStorage <= 0) {
    errors.push('Database allocated storage must be positive');
  }
  if (config.database.maxAllocatedStorage < config.database.allocatedStorage) {
    errors.push('Max allocated storage must be >= allocated storage');
  }
  
  // Validate password policy
  const pwd = config.cognito.passwordPolicy;
  if (pwd.minLength < 6 || pwd.minLength > 128) {
    errors.push('Password minimum length must be between 6 and 128');
  }
  
  // Validate API Gateway throttling
  if (config.apiGateway.throttling.rateLimit <= 0) {
    errors.push('API Gateway rate limit must be positive');
  }
  if (config.apiGateway.throttling.burstLimit < config.apiGateway.throttling.rateLimit) {
    errors.push('Burst limit must be >= rate limit');
  }
  
  // Validate Lambda config
  if (config.lambda.timeout <= 0 || config.lambda.timeout > 900) {
    errors.push('Lambda timeout must be between 1 and 900 seconds');
  }
  if (config.lambda.memorySize < 128 || config.lambda.memorySize > 10240) {
    errors.push('Lambda memory size must be between 128 and 10240 MB');
  }

  if (errors.length > 0) {
    throw new Error(`Environment configuration validation failed:\n${errors.join('\n')}`);
  }
}