import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardGate from '@/app/dashboard/DashboardGate';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock('next/dynamic', () => () => {
  return function MockDashboardView() {
    return <div data-testid="dashboard-home-view" />;
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

describe('DashboardGate', () => {
  beforeEach(() => {
    pushMock.mockClear();
    localStorageMock.clear();
    sessionStorageMock.clear();
  });

  it('redirects unauthenticated users to login', async () => {
    render(<DashboardGate />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/auth/login');
    });

    expect(screen.getByText(/redirecting to login/i)).toBeInTheDocument();
  });

  it('renders dashboard view when token is present', async () => {
    localStorageMock.setItem('accessToken', 'token');
    render(<DashboardGate />);

    expect(await screen.findByTestId('dashboard-home-view')).toBeInTheDocument();
  });
});
