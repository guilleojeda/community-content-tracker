import { getEnvironmentConfig } from '../../src/infrastructure/lib/config/environments';

describe('getEnvironmentConfig', () => {
  it('returns dev configuration with non-production defaults', () => {
    const config = getEnvironmentConfig('dev');

    expect(config.environment).toBe('dev');
    expect(config.isProductionLike).toBe(false);
    expect(config.cognito.mfaConfiguration).toBe('OFF');
    expect(config.lambda.tracing).toBe('PassThrough');
    expect(config.enableWaf).toBe(false);
  });

  it('returns prod configuration with production settings', () => {
    const config = getEnvironmentConfig('prod');

    expect(config.environment).toBe('prod');
    expect(config.isProductionLike).toBe(true);
    expect(config.cognito.mfaConfiguration).toBe('OPTIONAL');
    expect(config.lambda.tracing).toBe('Active');
    expect(config.enableWaf).toBe(true);
    expect(config.tags.Project).toBe('CommunityContentTracker');
  });

  it('applies deployment color overrides for blue environment', () => {
    const config = getEnvironmentConfig('blue');

    expect(config.environment).toBe('blue');
    expect(config.tags.DeploymentColor).toBe('blue');
    expect(config.isProductionLike).toBe(true);
  });

  it('throws for unknown environments', () => {
    expect(() => getEnvironmentConfig('unknown')).toThrow('Unknown environment');
  });
});
