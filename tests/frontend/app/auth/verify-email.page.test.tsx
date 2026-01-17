import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerifyEmailPage from '@/app/auth/verify-email/page';

const mockPush = jest.fn();
const mockVerifyEmail = jest.fn();
const mockResend = jest.fn();
let searchParamsValue: URLSearchParams | null = new URLSearchParams('email=user@example.com');

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => searchParamsValue,
}));

jest.mock('@/lib/api/lazyClient', () => ({
  loadPublicApiClient: jest.fn(() => Promise.resolve({
    verifyEmail: mockVerifyEmail,
    resendVerification: mockResend,
  })),
}));

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockVerifyEmail.mockReset();
    mockResend.mockReset();
    searchParamsValue = new URLSearchParams('email=user@example.com');
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders loading state when search params are unavailable', () => {
    searchParamsValue = null;
    render(<VerifyEmailPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('verifies email successfully and redirects', async () => {
    mockVerifyEmail.mockResolvedValue({ message: 'ok' });
    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalledWith({ email: 'user@example.com', confirmationCode: '123456' });
      expect(screen.getByText(/email verified successfully/i)).toBeInTheDocument();
    });
    jest.runOnlyPendingTimers();
    expect(mockPush).toHaveBeenCalledWith('/auth/login');
  });

  it('shows verification errors from API', async () => {
    mockVerifyEmail.mockRejectedValue(new Error('Bad code'));
    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    expect(await screen.findByText(/bad code/i)).toBeInTheDocument();
  });

  it('resends verification email and handles errors', async () => {
    mockResend.mockResolvedValue({ message: 'resent' });
    render(<VerifyEmailPage />);

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(await screen.findByText(/verification email sent/i)).toBeInTheDocument();

    mockResend.mockRejectedValueOnce(new Error('Resend failed'));
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(await screen.findByText(/resend failed/i)).toBeInTheDocument();
  });
});
