export interface EnvironmentConfig {
  environment: string;
  deletionProtection?: boolean;
  backupRetentionDays?: number;
  minCapacity?: number;
  maxCapacity?: number;
  enableWaf?: boolean;
  tags?: Record<string, string>;
  cognito: {
    deletionProtection: boolean;
    mfaConfiguration: string;
    advancedSecurityMode: string;
    passwordPolicy: {
      minLength: number;
      requireLowercase: boolean;
      requireUppercase: boolean;
      requireNumbers: boolean;
      requireSymbols: boolean;
      tempPasswordValidityDays: number;
    };
  };
  lambda: {
    timeout: number;
    memorySize: number;
    tracing: string;
    environmentVariables: Record<string, string>;
  };
}

export const getEnvironmentConfig = (environment: string): EnvironmentConfig => {
  const baseConfig = {
    tags: {
      Project: 'CommunityContentTracker',
      ManagedBy: 'CDK',
    },
    cognito: {
      deletionProtection: environment === 'prod',
      mfaConfiguration: environment === 'prod' ? 'OPTIONAL' : 'OFF',
      advancedSecurityMode: environment === 'prod' ? 'ENFORCED' : 'OFF',
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSymbols: environment === 'prod',
        tempPasswordValidityDays: 7,
      },
    },
    lambda: {
      timeout: 30,
      memorySize: 256,
      tracing: environment === 'prod' ? 'Active' : 'PassThrough',
      environmentVariables: {
        NODE_ENV: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
      },
    },
  };

  const configs: Record<string, EnvironmentConfig> = {
    dev: {
      environment: 'dev',
      deletionProtection: false,
      backupRetentionDays: 7,
      minCapacity: 0.5,
      maxCapacity: 1,
      enableWaf: false,
      ...baseConfig,
    },
    staging: {
      environment: 'staging',
      deletionProtection: false,
      backupRetentionDays: 14,
      minCapacity: 0.5,
      maxCapacity: 2,
      enableWaf: false,
      ...baseConfig,
    },
    prod: {
      environment: 'prod',
      deletionProtection: true,
      backupRetentionDays: 30,
      minCapacity: 1,
      maxCapacity: 4,
      enableWaf: true,
      ...baseConfig,
    },
  };

  return configs[environment] || configs.dev;
};