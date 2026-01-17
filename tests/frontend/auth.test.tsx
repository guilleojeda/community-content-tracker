import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import RegisterPage from '@/app/auth/register/page';
import LoginPage from '@/app/auth/login/page';
import VerifyEmailPage from '@/app/auth/verify-email/page';
import ForgotPasswordPage from '@/app/auth/forgot-password/page';
import ResetPasswordPage from '@/app/auth/reset-password/page';

type AuthClient = {
  register: jest.Mock;
  login: jest.Mock;
  verifyEmail: jest.Mock;
  resendVerification: jest.Mock;
  forgotPassword: jest.Mock;
  resetPassword: jest.Mock;
};

const mockClient: AuthClient = {
  register: jest.fn(),
  login: jest.fn(),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
};

jest.mock('@/lib/api/lazyClient', () => ({
  loadPublicApiClient: jest.fn(() => Promise.resolve(mockClient)),
}));

const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

Object.defineProperty(window, 'localStorage', {
  value: {
    data: {} as Record<string, string>,
    getItem(key: string) {
      return this.data[key] ?? null;
    },
    setItem(key: string, value: string) {
      this.data[key] = value;
    },
    removeItem(key: string) {
      delete this.data[key];
    },
    clear() {
      this.data = {};
    },
  },
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: {
    data: {} as Record<string, string>,
    getItem(key: string) {
      return this.data[key] ?? null;
    },
    setItem(key: string, value: string) {
      this.data[key] = value;
    },
    removeItem(key: string) {
      delete this.data[key];
    },
    clear() {
      this.data = {};
    },
  },
  writable: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RegisterPage', () => {
  it('validates matching passwords before submit', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password321!' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      expect(mockClient.register).not.toHaveBeenCalled();
    });
  });

  it('calls register API and redirects on success', async () => {
    jest.useFakeTimers();
    mockClient.register.mockResolvedValue({ userId: 'user-1', message: 'ok' });

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockClient.register).toHaveBeenCalledWith({
        email: 'test@example.com',
        username: 'testuser',
        password: 'Password123!',
      });
      expect(screen.getByText(/registration successful/i)).toBeInTheDocument();
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/auth/verify-email'));
    jest.useRealTimers();
  });

  it('surfaces API errors', async () => {
    mockClient.register.mockRejectedValue(new Error('Registration failed'));

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument();
    });
  });
});

describe('LoginPage', () => {
  it('stores tokens using remember me preference', async () => {
    mockClient.login.mockResolvedValue({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByLabelText(/remember me/i));

    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(mockClient.login).toHaveBeenCalledWith({ email: 'test@example.com', password: 'Password123!' });
      expect(window.localStorage.getItem('accessToken')).toBe('access');
    });
  });

  it('handles login failures', async () => {
    mockClient.login.mockRejectedValue(new Error('Login failed'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText(/login failed/i)).toBeInTheDocument();
    });
  });

  it('renders social login placeholders', () => {
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
  });
});

const mockUseSearchParams = useSearchParams as jest.Mock;

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue({ get: (key: string) => (key === 'email' ? 'test@example.com' : null) });
  });

  it('verifies email when code submitted', async () => {
    mockClient.verifyEmail.mockResolvedValue({ message: 'verified', verified: true });

    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(mockClient.verifyEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        confirmationCode: '123456',
      });
      expect(screen.getByText(/email verified successfully/i)).toBeInTheDocument();
    });
  });

  it('resends verification code', async () => {
    mockClient.resendVerification.mockResolvedValue({ message: 'resent' });

    render(<VerifyEmailPage />);

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(mockClient.resendVerification).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(screen.getByText(/verification email sent/i)).toBeInTheDocument();
    });
  });
});

describe('Password recovery', () => {
  it('requests password reset email', async () => {
    mockClient.forgotPassword.mockResolvedValue({ message: 'Reset email sent' });

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

    await waitFor(() => {
      expect(mockClient.forgotPassword).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(screen.getByText(/reset code sent/i)).toBeInTheDocument();
    });
  });

  it('resets password with confirmation code', async () => {
    mockClient.resetPassword.mockResolvedValue({ message: 'Password reset' });

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'NewPassword123!' } });

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(mockClient.resetPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        confirmationCode: '654321',
        newPassword: 'NewPassword123!',
      });
      expect(screen.getByText(/password reset successful/i)).toBeInTheDocument();
    });
  });

  it('validates password mismatch', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('validates password length', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'Short1!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'Short1!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 12 characters/i)).toBeInTheDocument();
    });
  });

  it('validates password complexity', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'password123!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'password123!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password must contain uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();
    });
  });

  it('validates reset code length', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/reset code must be 6 digits/i)).toBeInTheDocument();
    });
  });

  it('handles reset password error', async () => {
    mockClient.resetPassword.mockRejectedValue(new Error('Invalid reset code'));

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByPlaceholderText(/your.email@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.change(screen.getByPlaceholderText(/create a strong password/i), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByPlaceholderText(/confirm your new password/i), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid reset code/i)).toBeInTheDocument();
    });
  });
});
