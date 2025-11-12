const originalEnv = { ...process.env };

async function loadFlags() {
  return await import('@/lib/featureFlags');
}

describe('featureFlags module', () => {
  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  it('falls back to development defaults when env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES;
    delete process.env.NEXT_PUBLIC_FEEDBACK_URL;

    const flags = await loadFlags();

    expect(flags.appEnvironment).toBe('development');
    expect(flags.betaFeaturesEnabled).toBe(false);
    expect(flags.feedbackUrl).toBe('https://awscommunityhub.org/beta-feedback');
    expect(flags.isBetaEnvironment).toBe(false);
    expect(flags.isBetaModeActive()).toBe(false);
  });

  it('activates beta mode when feature flag is enabled', async () => {
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'TRUE';

    const flags = await loadFlags();

    expect(flags.betaFeaturesEnabled).toBe(true);
    expect(flags.isBetaModeActive()).toBe(true);
  });

  it('activates beta mode when environment is beta regardless of flags', async () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'BETA';
    delete process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES;

    const flags = await loadFlags();

    expect(flags.isBetaEnvironment).toBe(true);
    expect(flags.isBetaModeActive()).toBe(true);
  });

  it('uses custom feedback url when provided', async () => {
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';

    const flags = await loadFlags();

    expect(flags.feedbackUrl).toBe('https://example.com/feedback');
  });
});
