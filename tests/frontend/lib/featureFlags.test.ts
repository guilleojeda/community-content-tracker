const originalEnv = { ...process.env };

async function loadFlags() {
  return await import('@/lib/featureFlags');
}

describe('featureFlags module', () => {
  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  const setRequiredEnv = () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';
  };

  it('throws when required env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES;
    delete process.env.NEXT_PUBLIC_FEEDBACK_URL;

    await expect(loadFlags()).rejects.toThrow('NEXT_PUBLIC_ENVIRONMENT must be set');
  });

  it('activates beta mode when feature flag is enabled', async () => {
    setRequiredEnv();
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'TRUE';

    const flags = await loadFlags();

    expect(flags.betaFeaturesEnabled).toBe(true);
    expect(flags.isBetaModeActive()).toBe(true);
  });

  it('activates beta mode when environment is beta regardless of flags', async () => {
    setRequiredEnv();
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'BETA';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

    const flags = await loadFlags();

    expect(flags.isBetaEnvironment).toBe(true);
    expect(flags.isBetaModeActive()).toBe(true);
  });

  it('uses custom feedback url when provided', async () => {
    setRequiredEnv();
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';

    const flags = await loadFlags();

    expect(flags.feedbackUrl).toBe('https://example.com/feedback');
  });
});
