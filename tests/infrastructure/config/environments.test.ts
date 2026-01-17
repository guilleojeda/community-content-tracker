import { getEnvironmentConfig } from '../../../src/infrastructure/lib/config/environments';

describe('getEnvironmentConfig', () => {
  it('provides production parity for blue/green deployments', () => {
    const blue = getEnvironmentConfig('blue');
    const green = getEnvironmentConfig('green');
    const prod = getEnvironmentConfig('prod');

    expect(blue.lambda.environmentVariables.NODE_ENV).toBe('blue');
    expect(green.lambda.environmentVariables.NODE_ENV).toBe('green');
    expect(blue.lambda.tracing).toBe('Active');
    expect(green.cognito.standardThreatProtectionMode).toBe('ENFORCED');
    expect(prod.lambda.memorySize).toBe(blue.lambda.memorySize);
    expect(prod.lambda.memorySize).toBe(green.lambda.memorySize);
    expect(blue.tags?.DeploymentColor).toBe('blue');
    expect(green.tags?.DeploymentColor).toBe('green');
  });

  it('throws for unknown environments', () => {
    expect(() => getEnvironmentConfig('unknown-env')).toThrow(/Unknown environment/);
  });
});
