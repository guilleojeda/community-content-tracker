const path = require('path');
const nextConfig = require(path.resolve(__dirname, '../../../src/frontend/next.config.js'));

describe('Next.js bundle performance configuration', () => {
  it('enforces max asset size of 500KB', () => {
    const config = {};
    const result = nextConfig.webpack ? nextConfig.webpack(config, { isServer: false }) : config;
    const performance = result.performance || config.performance;

    expect(performance).toBeDefined();
    const limit = 500 * 1024;
    expect(performance.maxAssetSize).toBeLessThanOrEqual(limit);
    expect(performance.maxEntrypointSize).toBeLessThanOrEqual(limit);
  });

});
