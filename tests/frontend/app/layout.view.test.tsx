import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/link', () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

const mockIsBetaModeActive = jest.fn(() => false);

jest.mock('@/lib/featureFlags', () => ({
  isBetaModeActive: () => mockIsBetaModeActive(),
}));

jest.mock('next/dynamic', () => {
  return (_loader: unknown, options?: { loading?: () => React.ReactNode }) => {
    if (options?.loading) {
      options.loading();
    }
    return () => <div data-testid="cookie-consent-stub" />;
  };
});

const originalEnv = { ...process.env };

async function loadLayoutModule() {
  return await import('@/app/layout');
}

describe('RootLayout component', () => {
  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockIsBetaModeActive.mockReset();
  });

  const renderLayout = (element: React.ReactElement) => {
    const markup = renderToStaticMarkup(element);
    const bodyText = markup
      .replace(/<script.*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style.*?>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      markup,
      bodyText,
    };
  };

  it('renders without beta affordances when feature flag disabled', async () => {
    mockIsBetaModeActive.mockReturnValue(false);
    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    const { markup, bodyText } = renderLayout(
      <RootLayout>
        <div>Child content</div>
      </RootLayout>
    );

    expect(bodyText).toContain('Child content');
    expect(bodyText).not.toMatch(/Beta/i);
    expect(bodyText).not.toMatch(/Feedback/i);
    expect(markup).toMatch(/data-testid="cookie-consent-stub"/);
  });

  it('shows beta indicators and feedback entrypoints when feature flag active', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://community.aws';
    mockIsBetaModeActive.mockReturnValue(true);

    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    const { markup, bodyText } = renderLayout(
      <RootLayout>
        <p>Dashboard</p>
      </RootLayout>
    );

    expect(bodyText).toMatch(/Beta/i);
    expect(bodyText.match(/Feedback/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(layoutModule.metadata.metadataBase?.href).toBe('https://community.aws/');
    expect(markup).toMatch(/data-testid="cookie-consent-stub"/);
  });
});
