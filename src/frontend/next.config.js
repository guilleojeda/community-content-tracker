const path = require('path');
const dotenv = require('dotenv');
const { loadEnv } = require('./config/validateEnv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});
const usePreact = process.env.NEXT_PUBLIC_USE_PREACT === 'true';
const localApiEnabled = process.env.LOCAL_API_MODE === 'true';
const staticExportEnabled =
  !localApiEnabled &&
  (process.env.NEXT_PUBLIC_STATIC_EXPORT === 'true' ||
    process.env.NEXT_PUBLIC_ENABLE_STATIC_EXPORT === 'true');

const publicEnv = loadEnv();

const nextConfig = {
  reactStrictMode: true,
  ...(staticExportEnabled
    ? {
        output: 'export',
        trailingSlash: true,
        skipTrailingSlashRedirect: true,
      }
    : {}),
  distDir: '.next',
  env: publicEnv,
  images: {
    loader: 'custom',
    loaderFile: './src/lib/imageLoader.ts',
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.performance = config.performance || {};
      const fiveHundredKiB = 500 * 1024;
      config.performance.maxAssetSize = fiveHundredKiB;
      config.performance.maxEntrypointSize = fiveHundredKiB;
      if (config.optimization && config.optimization.splitChunks) {
        config.optimization.splitChunks.maxSize = 200000;
        config.optimization.splitChunks.minSize = 10000;
      }
    }
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      if (process.env.NODE_ENV === 'production' && usePreact) {
        // Swap React with Preact in production bundles to slim bundle size.
        Object.assign(config.resolve.alias, {
          react: 'preact/compat',
          'react$': 'preact/compat',
          'react-dom/test-utils': 'preact/test-utils',
          'react-dom': 'preact/compat',
          'react-dom$': 'preact/compat',
          'react-dom/server': 'preact/compat/server',
          'react/jsx-runtime': 'preact/jsx-runtime',
          'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
        });
      } else {
        // Use Next's bundled React build to ensure RSC client helpers are available.
        Object.assign(config.resolve.alias, {
          react: 'next/dist/compiled/react',
          'react$': 'next/dist/compiled/react',
          'react-dom': 'next/dist/compiled/react-dom',
          'react-dom$': 'next/dist/compiled/react-dom',
          'react/jsx-runtime': 'next/dist/compiled/react/jsx-runtime',
          'react/jsx-dev-runtime': 'next/dist/compiled/react/jsx-dev-runtime',
        });
      }
    }
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
