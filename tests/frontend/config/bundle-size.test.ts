const path = require('path');
const nextConfig = require(path.join(process.cwd(), 'next.config.js'));

describe('Next.js bundle performance configuration', () => {
  it('enforces max asset size of 200KB', () => {
    const config = {};
    const result = nextConfig.webpack ? nextConfig.webpack(config, { isServer: false }) : config;
    const performance = result.performance || config.performance;

    expect(performance).toBeDefined();
    const limit = 200 * 1024;
    expect(performance.maxAssetSize).toBeLessThanOrEqual(limit);
    expect(performance.maxEntrypointSize).toBeLessThanOrEqual(limit);
  });

  it('applies cache headers to policy pages', async () => {
    const headers = await nextConfig.headers();
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/privacy',
          headers: expect.arrayContaining([
            expect.objectContaining({
              key: 'Cache-Control',
              value: expect.stringContaining('max-age=86400'),
            }),
          ]),
        }),
      ])
    );
  });

  it('includes required security headers on every route', async () => {
    const headers = await nextConfig.headers();
    const globalRule = headers.find((entry: any) => entry.source === '/(.*)');
    expect(globalRule).toBeDefined();

    const headerMap = Object.fromEntries(
      (globalRule?.headers || []).map(({ key, value }: { key: string; value: string }) => [key, value])
    );

    expect(headerMap['Strict-Transport-Security']).toContain('max-age=');
    expect(headerMap['X-Frame-Options']).toBe('DENY');
    expect(headerMap['Content-Security-Policy']).toContain("default-src 'self'");
  });
});
