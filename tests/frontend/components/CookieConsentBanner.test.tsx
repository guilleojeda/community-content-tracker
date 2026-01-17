import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CookieConsentBanner from '@/components/CookieConsentBanner';

describe('CookieConsentBanner', () => {
  const originalLocalStorage = window.localStorage;
  const originalSessionStorage = window.sessionStorage;

  beforeEach(() => {
    jest.resetAllMocks();

    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          Object.keys(store).forEach((key) => delete store[key]);
        }),
      },
      writable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage });
    Object.defineProperty(window, 'sessionStorage', { value: originalSessionStorage });
  });

  it('renders consent banner when no preference stored', () => {
    render(<CookieConsentBanner />);

    expect(screen.getByText(/we use cookies/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('records acceptance and notifies backend', async () => {
    const mockClient = { manageConsent: jest.fn() };
    jest.spyOn(require('@/lib/api/lazyClient'), 'loadAuthenticatedApiClient').mockResolvedValue(mockClient);

    render(<CookieConsentBanner />);

    window.localStorage.setItem('accessToken', 'token');
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(mockClient.manageConsent).toHaveBeenCalledWith({
        consentType: 'analytics',
        granted: true,
      });
    });
    expect(window.localStorage.setItem).toHaveBeenCalledWith('cookie-consent', 'accepted');
    expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
  });

  it('records acceptance without access token and skips backend call', async () => {
    const clientSpy = jest.spyOn(require('@/lib/api/lazyClient'), 'loadAuthenticatedApiClient');

    render(<CookieConsentBanner />);

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
    });

    expect(window.localStorage.setItem).toHaveBeenCalledWith('cookie-consent', 'accepted');
    expect(clientSpy).not.toHaveBeenCalled();
  });

  it('hides banner even if consent update fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockClient = { manageConsent: jest.fn().mockRejectedValue(new Error('network')) };
    jest.spyOn(require('@/lib/api/lazyClient'), 'loadAuthenticatedApiClient').mockResolvedValue(mockClient);

    render(<CookieConsentBanner />);

    window.localStorage.setItem('accessToken', 'token');
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('records decline without hitting backend', () => {
    render(<CookieConsentBanner />);

    fireEvent.click(screen.getByRole('button', { name: /decline/i }));

    expect(window.localStorage.setItem).toHaveBeenCalledWith('cookie-consent', 'declined');
    expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
  });

  it('does not render when consent already given', () => {
    window.localStorage.setItem('cookie-consent', 'accepted');

    render(<CookieConsentBanner />);

    expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
  });

  it('does not render when consent already declined', () => {
    window.localStorage.setItem('cookie-consent', 'declined');

    render(<CookieConsentBanner />);

    expect(screen.queryByText(/we use cookies/i)).not.toBeInTheDocument();
  });
});
