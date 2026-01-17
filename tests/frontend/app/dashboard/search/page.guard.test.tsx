import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AuthenticatedSearchPage from '@/app/dashboard/search/page';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock('next/dynamic', () => () => {
  return function MockSearchPage() {
    return <div data-testid="search-page-client" />;
  };
});

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

describe('AuthenticatedSearchPage guard', () => {
  beforeEach(() => {
    pushMock.mockClear();
    localStorageMock.clear();
    sessionStorageMock.clear();
  });

  it('redirects to login when unauthenticated', async () => {
    render(<AuthenticatedSearchPage />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/auth/login');
    });

    expect(screen.getByText(/redirecting to login/i)).toBeInTheDocument();
  });

  it('renders search client when token is present', async () => {
    sessionStorageMock.setItem('accessToken', 'token');
    render(<AuthenticatedSearchPage />);

    expect(await screen.findByTestId('search-page-client')).toBeInTheDocument();
  });
});
