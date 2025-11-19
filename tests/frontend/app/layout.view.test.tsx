import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockIsBetaModeActive = jest.fn(() => false);

jest.mock('@/lib/featureFlags', () => ({
  isBetaModeActive: () => mockIsBetaModeActive(),
}));

jest.mock('next/dynamic', () => {
  return () => () => <div data-testid="cookie-consent-stub" />;
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

  const renderLayoutToDocument = (element: React.ReactElement) => {
    const markup = renderToStaticMarkup(element);
    const parser = new window.DOMParser();
    return parser.parseFromString(markup, 'text/html');
  };

  it('renders without beta affordances when feature flag disabled', async () => {
    mockIsBetaModeActive.mockReturnValue(false);
    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    const doc = renderLayoutToDocument(
      <RootLayout>
        <div>Child content</div>
      </RootLayout>
    );

    expect(doc.querySelector('body')?.textContent).toContain('Child content');
    expect(doc.querySelector('body')?.textContent).not.toMatch(/Beta/i);
    expect(doc.querySelector('body')?.textContent).not.toMatch(/Feedback/i);
    expect(doc.querySelector('[data-testid="cookie-consent-stub"]')).not.toBeNull();
  });

  it('shows beta indicators and feedback entrypoints when feature flag active', async () => {
    process.env.NEXT_PUBLIC_DOMAIN = 'community.aws';
    mockIsBetaModeActive.mockReturnValue(true);

    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    const doc = renderLayoutToDocument(
      <RootLayout>
        <p>Dashboard</p>
      </RootLayout>
    );

    const bodyText = doc.querySelector('body')?.textContent ?? '';
    expect(bodyText).toMatch(/Beta/i);
    expect(bodyText.match(/Feedback/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(layoutModule.metadata.metadataBase?.href).toBe('https://community.aws/');
  });
});
