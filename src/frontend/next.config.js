const { loadEnv } = require('./config/validateEnv');

const publicEnv = loadEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: '.next',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  env: publicEnv,
};

module.exports = nextConfig;
