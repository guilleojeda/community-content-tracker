import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import RegisterPage from '@/app/auth/register/page';
import LoginPage from '@/app/auth/login/page';
import VerifyEmailPage from '@/app/auth/verify-email/page';
import ForgotPasswordPage from '@/app/auth/forgot-password/page';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mock fetch API
global.fetch = jest.fn();

// Mock localStorage and sessionStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
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
    getItem: (key: string) => store[key] || null,
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

describe('Authentication Tests', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (global.fetch as jest.Mock).mockClear();
    localStorageMock.clear();
    sessionStorageMock.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Registration Page', () => {
    describe('Form Rendering', () => {
      it('should render registration form with all fields', () => {
        render(<RegisterPage />);

        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
      });

      it('should render terms of service checkbox', () => {
        render(<RegisterPage />);

        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeInTheDocument();
        expect(checkbox).toHaveAttribute('required');
      });

      it('should render link to login page', () => {
        render(<RegisterPage />);

        const loginLink = screen.getByRole('link', { name: /login here/i });
        expect(loginLink).toHaveAttribute('href', '/auth/login');
      });
    });

    describe('Form Validation', () => {
      it('should show error when passwords do not match', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'DifferentPassword123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
        });
      });

      it('should show error when password is too short', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Short1!' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Short1!' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText(/password must be at least 12 characters/i)).toBeInTheDocument();
        });
      });

      it('should show error for invalid username characters', async () => {
        render(<RegisterPage />);

        const form = screen.getByRole('button', { name: /create account/i }).closest('form');

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });

        // Input invalid username that bypasses HTML5 pattern by setting value directly
        const usernameInput = screen.getByLabelText(/^username/i);
        Object.defineProperty(usernameInput, 'value', {
          writable: true,
          value: 'test user!'
        });
        fireEvent.change(usernameInput, { target: { value: 'test user!' } });

        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        // Trigger form submit event directly to bypass HTML5 validation
        if (form) {
          fireEvent.submit(form);
        }

        await waitFor(() => {
          expect(
            screen.getByText(/username can only contain letters, numbers, hyphens, and underscores/i)
          ).toBeInTheDocument();
        });
      });

      it('should accept valid username formats', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

        render(<RegisterPage />);

        const validUsernames = ['testuser', 'test-user', 'test_user', 'TestUser123'];

        for (const username of validUsernames) {
          fireEvent.change(screen.getByLabelText(/^username/i), {
            target: { value: username },
          });
          fireEvent.change(screen.getByLabelText(/^email/i), {
            target: { value: 'test@example.com' },
          });
          fireEvent.change(screen.getByLabelText(/^password$/i), {
            target: { value: 'Password123!@#$' },
          });
          fireEvent.change(screen.getByLabelText(/confirm password/i), {
            target: { value: 'Password123!@#$' },
          });

          fireEvent.click(screen.getByRole('button', { name: /create account/i }));

          await waitFor(() => {
            expect(screen.queryByText(/username can only contain/i)).not.toBeInTheDocument();
          });

          (global.fetch as jest.Mock).mockClear();
        }
      });
    });

    describe('Registration Flow', () => {
      it('should successfully register and redirect to verify email', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

        render(<RegisterPage />);

        const form = screen.getByRole('button', { name: /create account/i }).closest('form');

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        // Submit form directly
        if (form) {
          fireEvent.submit(form);
        }

        await waitFor(() => {
          expect(screen.getByText(/registration successful/i)).toBeInTheDocument();
        });

        // Wait for redirect
        await waitFor(
          () => {
            expect(mockPush).toHaveBeenCalledWith(
              '/auth/verify-email?email=test%40example.com'
            );
          },
          { timeout: 3000 }
        );
      });

      it('should display error message on registration failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Email already exists' } }),
        });

        render(<RegisterPage />);

        const form = screen.getByRole('button', { name: /create account/i }).closest('form');

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'existing@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        if (form) {
          fireEvent.submit(form);
        }

        await waitFor(() => {
          expect(screen.getByText('Email already exists')).toBeInTheDocument();
        });
      });

      it('should disable button while loading', async () => {
        (global.fetch as jest.Mock).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
            )
        );

        render(<RegisterPage />);

        const form = screen.getByRole('button', { name: /create account/i }).closest('form');

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        if (form) {
          fireEvent.submit(form);
        }

        const button = screen.getByRole('button', { name: /creating account/i });
        expect(button).toBeDisabled();
      });

      it('should show error when password missing uppercase letter', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText(/password must contain uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();
        });
      });

      it('should show error when password missing lowercase letter', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'PASSWORD123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'PASSWORD123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText(/password must contain uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();
        });
      });

      it('should show error when password missing number', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'PasswordOnly!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'PasswordOnly!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText(/password must contain uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();
        });
      });

      it('should show error when password missing symbol', async () => {
        render(<RegisterPage />);

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password1234567' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password1234567' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
          expect(screen.getByText(/password must contain uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();
        });
      });

      it('should handle network errors gracefully', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        render(<RegisterPage />);

        const form = screen.getByRole('button', { name: /create account/i }).closest('form');

        fireEvent.change(screen.getByLabelText(/^email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/^username/i), {
          target: { value: 'testuser' },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.change(screen.getByLabelText(/confirm password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox'));

        if (form) {
          fireEvent.submit(form);
        }

        await waitFor(() => {
          expect(screen.getByText('Network error')).toBeInTheDocument();
        });
      });
    });
  });

  describe('Login Page', () => {
    describe('Form Rendering', () => {
      it('should render login form with all fields', () => {
        render(<LoginPage />);

        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^login$/i })).toBeInTheDocument();
      });

      it('should render remember me checkbox', () => {
        render(<LoginPage />);

        const checkbox = screen.getByRole('checkbox', { name: /remember me/i });
        expect(checkbox).toBeInTheDocument();
        expect(checkbox).not.toBeChecked();
      });

      it('should render forgot password link', () => {
        render(<LoginPage />);

        const forgotLink = screen.getByRole('link', { name: /forgot password/i });
        expect(forgotLink).toHaveAttribute('href', '/auth/forgot-password');
      });

      it('should render registration link', () => {
        render(<LoginPage />);

        const registerLink = screen.getByRole('link', { name: /register here/i });
        expect(registerLink).toHaveAttribute('href', '/auth/register');
      });
    });

    describe('Login Flow', () => {
      it('should successfully login and store tokens in localStorage when remember me is checked', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'test-access-token',
            idToken: 'test-id-token',
          }),
        });

        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/password/i), {
          target: { value: 'Password123!@#$' },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: /remember me/i }));

        fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

        await waitFor(() => {
          expect(localStorageMock.getItem('accessToken')).toBe('test-access-token');
          expect(localStorageMock.getItem('idToken')).toBe('test-id-token');
          expect(mockPush).toHaveBeenCalledWith('/');
        });
      });

      it('should store tokens in sessionStorage when remember me is not checked', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'test-access-token',
            idToken: 'test-id-token',
          }),
        });

        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/password/i), {
          target: { value: 'Password123!@#$' },
        });

        fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

        await waitFor(() => {
          expect(sessionStorageMock.getItem('accessToken')).toBe('test-access-token');
          expect(sessionStorageMock.getItem('idToken')).toBe('test-id-token');
          expect(mockPush).toHaveBeenCalledWith('/');
        });
      });

      it('should display error message on login failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Invalid credentials' } }),
        });

        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/password/i), {
          target: { value: 'WrongPassword' },
        });

        fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

        await waitFor(() => {
          expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
        });
      });

      it('should disable button while loading', async () => {
        (global.fetch as jest.Mock).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: true,
                    json: async () => ({ accessToken: 'token', idToken: 'token' }),
                  }),
                100
              )
            )
        );

        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/email/i), {
          target: { value: 'test@example.com' },
        });
        fireEvent.change(screen.getByLabelText(/password/i), {
          target: { value: 'Password123!@#$' },
        });

        fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

        const button = screen.getByRole('button', { name: /logging in/i });
        expect(button).toBeDisabled();
      });
    });

    describe('Remember Me Feature', () => {
      it('should toggle remember me checkbox', () => {
        render(<LoginPage />);

        const checkbox = screen.getByRole('checkbox', { name: /remember me/i });
        expect(checkbox).not.toBeChecked();

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
      });
    });
  });

  describe('Email Verification Page', () => {
    const mockSearchParams = new URLSearchParams();

    beforeEach(() => {
      mockSearchParams.set('email', 'test@example.com');
      (useSearchParams as jest.Mock).mockReturnValue({
        get: (key: string) => mockSearchParams.get(key),
      });
    });

    describe('Form Rendering', () => {
      it('should render verification form with email from URL', () => {
        render(<VerifyEmailPage />);

        expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /verify email/i })).toBeInTheDocument();
      });

      it('should render resend button', () => {
        render(<VerifyEmailPage />);

        expect(screen.getByRole('button', { name: /resend verification email/i })).toBeInTheDocument();
      });
    });

    describe('Verification Flow', () => {
      it('should successfully verify email and redirect to login', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

        render(<VerifyEmailPage />);

        fireEvent.change(screen.getByLabelText(/verification code/i), {
          target: { value: '123456' },
        });

        fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

        await waitFor(() => {
          expect(screen.getByText(/email verified successfully/i)).toBeInTheDocument();
        });

        await waitFor(
          () => {
            expect(mockPush).toHaveBeenCalledWith('/auth/login');
          },
          { timeout: 3000 }
        );
      });

      it('should display error on verification failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Invalid verification code' } }),
        });

        render(<VerifyEmailPage />);

        fireEvent.change(screen.getByLabelText(/verification code/i), {
          target: { value: '000000' },
        });

        fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

        await waitFor(() => {
          expect(screen.getByText('Invalid verification code')).toBeInTheDocument();
        });
      });

      it('should limit code input to 6 characters', () => {
        render(<VerifyEmailPage />);

        const input = screen.getByLabelText(/verification code/i);
        expect(input).toHaveAttribute('maxLength', '6');
      });

      it('should disable button while loading', async () => {
        (global.fetch as jest.Mock).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
            )
        );

        render(<VerifyEmailPage />);

        fireEvent.change(screen.getByLabelText(/verification code/i), {
          target: { value: '123456' },
        });

        fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

        const button = screen.getByRole('button', { name: /verifying/i });
        expect(button).toBeDisabled();
      });
    });
  });

  describe('Forgot Password Page', () => {
    describe('Form Rendering', () => {
      it('should render forgot password form', () => {
        render(<ForgotPasswordPage />);

        expect(screen.getByText('Forgot Password')).toBeInTheDocument();
        expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /send reset code/i })).toBeInTheDocument();
      });

      it('should render back to login link', () => {
        render(<ForgotPasswordPage />);

        const loginLink = screen.getByRole('link', { name: /login here/i });
        expect(loginLink).toHaveAttribute('href', '/auth/login');
      });
    });

    describe('Password Reset Flow', () => {
      it('should successfully send reset code and redirect', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

        render(<ForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: 'test@example.com' },
        });

        fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

        await waitFor(() => {
          expect(screen.getByText(/reset code sent/i)).toBeInTheDocument();
        });

        await waitFor(
          () => {
            expect(mockPush).toHaveBeenCalledWith(
              '/auth/reset-password?email=test%40example.com'
            );
          },
          { timeout: 3000 }
        );
      });

      it('should display error on failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'User not found' } }),
        });

        render(<ForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: 'nonexistent@example.com' },
        });

        fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

        await waitFor(() => {
          expect(screen.getByText('User not found')).toBeInTheDocument();
        });
      });

      it('should disable button while loading', async () => {
        (global.fetch as jest.Mock).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
            )
        );

        render(<ForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: 'test@example.com' },
        });

        fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

        const button = screen.getByRole('button', { name: /sending/i });
        expect(button).toBeDisabled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle network errors gracefully in registration', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<RegisterPage />);

      const form = screen.getByRole('button', { name: /create account/i }).closest('form');

      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^username/i), {
        target: { value: 'testuser' },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: 'Password123!@#$' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'Password123!@#$' },
      });
      fireEvent.click(screen.getByRole('checkbox'));

      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should handle empty form submission attempts', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toHaveAttribute('required');
      expect(passwordInput).toHaveAttribute('required');
    });

    it('should clear error messages when retrying', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Invalid credentials' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ accessToken: 'token', idToken: 'token' }),
        });

      render(<LoginPage />);

      // First attempt - should fail
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'Wrong' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      });

      // Second attempt - should succeed
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'Correct123!@#$' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

      await waitFor(() => {
        expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper form labels in registration', () => {
      render(<RegisterPage />);

      expect(screen.getByLabelText(/email/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/^username/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/^password$/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/confirm password/i)).toHaveAccessibleName();
    });

    it('should have proper form labels in login', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/email/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/password/i)).toHaveAccessibleName();
    });

    it('should have proper heading hierarchy', () => {
      render(<RegisterPage />);

      const h1 = screen.getByRole('heading', { level: 1, name: /register/i });
      expect(h1).toBeInTheDocument();
    });
  });
});
