const { loadEnv } = require('./config/validateEnv');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const publicEnv = loadEnv();

/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
  },
];

const nextConfig = {
  reactStrictMode: true,
  distDir: '.next',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  env: publicEnv,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  webpack: (config, { isServer }) => {
    config.performance = config.performance || {};
    const twoHundredKiB = 200 * 1024;
    config.performance.maxAssetSize = twoHundredKiB;
    config.performance.maxEntrypointSize = twoHundredKiB;
    if (!isServer && config.optimization && config.optimization.splitChunks) {
      config.optimization.splitChunks.maxSize = 200000;
      config.optimization.splitChunks.minSize = 10000;
      if (process.env.NODE_ENV === 'production') {
        // Swap React with Preact in production client builds to slim bundle size.
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        Object.assign(config.resolve.alias, {
          react: 'preact/compat',
          'react-dom/test-utils': 'preact/test-utils',
          'react-dom': 'preact/compat',
          'react/jsx-runtime': 'preact/jsx-runtime',
          'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
        });
      }
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/privacy',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=43200',
          },
        ],
      },
      {
        source: '/terms',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=43200',
          },
        ],
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
