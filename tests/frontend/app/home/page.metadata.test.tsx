import React from 'react';
import HomePageContent from '@/app/HomePageContent';
import { render, screen } from '@testing-library/react';

const mockGetStats = jest.fn().mockResolvedValue(null);
const mockPush = jest.fn();

jest.mock('@/lib/api/lazyClient', () => ({
  loadPublicApiClient: jest.fn(() => Promise.resolve({
    getStats: mockGetStats,
  })),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

afterEach(() => {
  mockGetStats.mockClear();
  mockPush.mockClear();
});

const loadMetadata = () => {
  jest.resetModules();
  const { resetClientEnvironmentCache } = require('@/config/environment');
  resetClientEnvironmentCache();
  return require('@/app/page').metadata as typeof import('@/app/page').metadata;
};

describe('Home page metadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    process.env.NEXT_PUBLIC_AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
    delete process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
    delete process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defines SEO and social sharing fields', () => {
    const metadata = loadMetadata();

    expect(metadata.title).toContain('AWS Community Content Hub');
    expect(metadata.description).toContain('Search and track');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/og-image.svg');
    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.alternates?.canonical).toMatch(/^https?:\/\//);
  });

  it('includes verification metadata when configured', () => {
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION = 'google-site-code';
    process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION = 'yandex-site-code';

    const metadata = loadMetadata();

    expect(metadata.verification).toEqual({
      google: 'google-site-code',
      yandex: 'yandex-site-code',
    });
  });

  it('omits verification metadata when not configured', () => {
    const metadata = loadMetadata();

    expect(metadata.verification).toBeUndefined();
  });
});

describe('Home page responsiveness', () => {
  it('renders responsive hero sections and imagery', () => {
    render(<HomePageContent />);

    const heroHeading = screen.getByText(/Discover AWS Community Content/i);
    expect(heroHeading).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search for AWS content/i)).toBeInTheDocument();

    const illustration = screen.getByAltText('Community illustration');
    expect(illustration).toBeInTheDocument();
  });

  it('renders the home page wrapper', () => {
    process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    process.env.NEXT_PUBLIC_AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';

    jest.isolateModules(() => {
      const { resetClientEnvironmentCache } = require('@/config/environment');
      resetClientEnvironmentCache();

      const HomePage = require('@/app/page').default;
      const HomePageContentLocal = require('@/app/HomePageContent').default;
      const element = HomePage();

      expect(element.type).toBe(HomePageContentLocal);
    });
  });
});
