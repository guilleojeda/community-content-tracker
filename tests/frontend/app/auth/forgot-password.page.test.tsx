import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ForgotPasswordPage from '@/app/auth/forgot-password/page';

const mockPush = jest.fn();
const mockForgotPassword = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/api/client', () => ({
  getPublicApiClient: () => ({
    forgotPassword: mockForgotPassword,
  }),
}));

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockForgotPassword.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('submits email and redirects on success', async () => {
    mockForgotPassword.mockResolvedValue({ message: 'sent' });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

    expect(mockForgotPassword).toHaveBeenCalledWith({ email: 'user@example.com' });

    await waitFor(() => expect(screen.getByText(/reset code sent/i)).toBeInTheDocument());
    jest.runOnlyPendingTimers();
    expect(mockPush).toHaveBeenCalledWith('/auth/reset-password?email=user%40example.com');
  });

  it('shows API errors when request fails', async () => {
    mockForgotPassword.mockRejectedValue(new Error('Request failed'));
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));

    expect(await screen.findByText(/request failed/i)).toBeInTheDocument();
  });
});
