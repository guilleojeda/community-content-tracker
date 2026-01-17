export interface EnvironmentConfig {
  environment: string;
  isProductionLike?: boolean;
  deletionProtection?: boolean;
  backupRetentionDays?: number;
  minCapacity?: number;
  maxCapacity?: number;
  enableWaf?: boolean;
  tags?: Record<string, string>;
  cognito: {
    deletionProtection: boolean;
    mfaConfiguration: string;
    standardThreatProtectionMode: string;
    customThreatProtectionMode?: string;
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

type LambdaConfigOverrides = Partial<EnvironmentConfig['lambda']> & {
  environmentVariables?: Record<string, string>;
};

type CognitoConfigOverrides = Partial<Omit<EnvironmentConfig['cognito'], 'passwordPolicy'>> & {
  passwordPolicy?: Partial<EnvironmentConfig['cognito']['passwordPolicy']>;
};

interface EnvironmentOverrides {
  isProductionLike?: boolean;
  deletionProtection?: boolean;
  backupRetentionDays?: number;
  minCapacity?: number;
  maxCapacity?: number;
  enableWaf?: boolean;
  tags?: Record<string, string>;
  lambda?: LambdaConfigOverrides;
  cognito?: CognitoConfigOverrides;
}

export const getEnvironmentConfig = (environment: string): EnvironmentConfig => {
  const createBaseConfig = (targetEnvironment: string) => {
    const isProductionLike = ['prod', 'blue', 'green'].includes(targetEnvironment);

    return {
      isProductionLike,
      tags: {
        Project: 'CommunityContentTracker',
        ManagedBy: 'CDK',
      },
      cognito: {
        deletionProtection: isProductionLike,
        mfaConfiguration: isProductionLike ? 'OPTIONAL' : 'OFF',
        standardThreatProtectionMode: isProductionLike ? 'ENFORCED' : 'OFF',
        passwordPolicy: {
          minLength: 12,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSymbols: isProductionLike,
          tempPasswordValidityDays: 7,
        },
      },
      lambda: {
        timeout: 30,
        memorySize: 256,
        tracing: isProductionLike ? 'Active' : 'PassThrough',
        environmentVariables: {
          NODE_ENV: targetEnvironment,
          LOG_LEVEL: isProductionLike ? 'info' : 'debug',
          ENABLE_BETA_FEATURES: 'false',
        },
      },
    };
  };

  const mergeConfig = (
    targetEnvironment: string,
    overrides: EnvironmentOverrides = {}
  ): EnvironmentConfig => {
    const baseConfig = createBaseConfig(targetEnvironment);
    return {
      ...baseConfig,
      ...overrides,
      environment: targetEnvironment,
      isProductionLike: overrides.isProductionLike ?? baseConfig.isProductionLike,
      tags: {
        ...baseConfig.tags,
        ...(overrides.tags ?? {}),
      },
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
    };
  };

  const configs: Record<string, EnvironmentConfig> = {
    dev: mergeConfig('dev', {
      deletionProtection: false,
      backupRetentionDays: 7,
      minCapacity: 0.5,
      maxCapacity: 1,
      enableWaf: false,
    }),
    beta: mergeConfig('beta', {
      deletionProtection: false,
      backupRetentionDays: 14,
      minCapacity: 0.5,
      maxCapacity: 2,
      enableWaf: false,
      lambda: {
        environmentVariables: {
          ENABLE_BETA_FEATURES: 'true',
        },
      },
    }),
    staging: mergeConfig('staging', {
      deletionProtection: false,
      backupRetentionDays: 14,
      minCapacity: 0.5,
      maxCapacity: 2,
      enableWaf: false,
    }),
    prod: mergeConfig('prod', {
      deletionProtection: true,
      backupRetentionDays: 30,
      minCapacity: 1,
      maxCapacity: 4,
      enableWaf: true,
    }),
    blue: mergeConfig('blue', {
      deletionProtection: true,
      backupRetentionDays: 30,
      minCapacity: 1,
      maxCapacity: 4,
      enableWaf: true,
      tags: {
        DeploymentColor: 'blue',
      },
    }),
    green: mergeConfig('green', {
      deletionProtection: true,
      backupRetentionDays: 30,
      minCapacity: 1,
      maxCapacity: 4,
      enableWaf: true,
      tags: {
        DeploymentColor: 'green',
      },
    }),
  };

  const selectedConfig = configs[environment];
  if (!selectedConfig) {
    throw new Error(
      `Unknown environment: ${environment}. Available environments: ${Object.keys(configs).join(', ')}`
    );
  }

  return selectedConfig;
};
