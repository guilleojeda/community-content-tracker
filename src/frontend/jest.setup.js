// Jest setup for frontend tests
require('@testing-library/jest-dom');
const { resetClientEnvironmentCache } = require('@/config/environment');

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Next.js Image to avoid DOM attribute warnings
jest.mock('next/image', () => {
  const React = require('react');
  const MockImage = React.forwardRef(({ priority, loader, src, ...rest }, ref) => {
    return React.createElement('img', {
      ref,
      src: typeof src === 'string' ? src : '',
      ...rest,
    });
  });
  MockImage.displayName = 'MockNextImage';
  return { __esModule: true, default: MockImage };
});

// Mock Next.js environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://awscommunityhub.org/beta-feedback';
process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock scrollTo for jsdom environment
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    value: () => {},
    writable: true,
  });
}

// Mock matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  resetClientEnvironmentCache();
});
