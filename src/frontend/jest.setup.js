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

const shouldSuppressErrorLog = (message) => {
  if (!message) {
    return false;
  }
  return (
    message.includes('Warning: ReactDOM.render') ||
    message.includes('Not implemented: HTMLFormElement.prototype.submit') ||
    message.includes('Error: Not implemented') ||
    (message.includes('Warning: An update to') && message.includes('inside a test was not wrapped in act')) ||
    message.startsWith('Search error:') ||
    message.includes('useAdminContext must be used within an AdminContextProvider') ||
    message.includes('The above error occurred in the <TestComponent> component')
  );
};

const shouldSuppressInfoLog = (message) => {
  if (!message) {
    return false;
  }
  return (
    message.startsWith('Search Analytics:') ||
    message.includes('Static placeholder exported')
  );
};

// Suppress console noise during tests unless DEBUG is set
if (!process.env.DEBUG) {
  const originalError = console.error;
  const originalLog = console.log;
  beforeAll(() => {
    console.error = (...args) => {
      const message = args
        .map((value) => (typeof value === 'string' ? value : String(value)))
        .join(' ');
      if (shouldSuppressErrorLog(message)) {
        return;
      }
      originalError.call(console, ...args);
    };

    console.log = (...args) => {
      const message = args
        .map((value) => (typeof value === 'string' ? value : String(value)))
        .join(' ');
      if (shouldSuppressInfoLog(message)) {
        return;
      }
      originalLog.call(console, ...args);
    };
  });

  afterAll(() => {
    console.error = originalError;
    console.log = originalLog;
  });
}

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
