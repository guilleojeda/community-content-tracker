import React from 'react';
import { render, screen } from '@testing-library/react';

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

  it('renders without beta affordances when feature flag disabled', async () => {
    mockIsBetaModeActive.mockReturnValue(false);
    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    render(
      <RootLayout>
        <div>Child content</div>
      </RootLayout>
    );

    expect(screen.queryByText(/Beta/i)).toBeNull();
    expect(screen.queryByText(/Feedback/i)).toBeNull();
    expect(screen.getByTestId('cookie-consent-stub')).toBeInTheDocument();
  });

  it('shows beta indicators and feedback entrypoints when feature flag active', async () => {
    process.env.NEXT_PUBLIC_DOMAIN = 'community.aws';
    mockIsBetaModeActive.mockReturnValue(true);

    const layoutModule = await loadLayoutModule();
    const RootLayout = layoutModule.default;

    render(
      <RootLayout>
        <p>Dashboard</p>
      </RootLayout>
    );

    expect(screen.getByText(/Beta/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Feedback/i).length).toBeGreaterThanOrEqual(1);
    expect(layoutModule.metadata.metadataBase?.href).toBe('https://community.aws/');
  });
});
