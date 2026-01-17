import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegisterPage from '@/app/auth/register/page';

const mockPush = jest.fn();
const mockRegister = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api/lazyClient', () => ({
  loadPublicApiClient: jest.fn(() => Promise.resolve({
    register: mockRegister,
  })),
}));

const fillForm = () => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'valid_user' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'ValidPassword123!' } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'ValidPassword123!' } });
  fireEvent.click(screen.getByRole('checkbox'));
};

describe('RegisterPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockRegister.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('validates password mismatch and complexity rules', async () => {
    render(<RegisterPage />);
    const form = document.querySelector('form');
    if (form) {
      (form as HTMLFormElement).noValidate = true;
    }

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'valid_user' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Short1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Mismatch1!' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Short1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/password must be at least 12 characters long/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'lowercasepassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/uppercase, lowercase, numbers, and symbols/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'ValidPassword123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'ValidPassword123!' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'invalid username' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/username can only contain/i)).toBeInTheDocument();
  });

  it('submits registration and redirects on success', async () => {
    mockRegister.mockResolvedValue({ message: 'ok' });
    render(<RegisterPage />);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'user@example.com',
        username: 'valid_user',
        password: 'ValidPassword123!',
      });
      expect(screen.getByText(/registration successful/i)).toBeInTheDocument();
    });

    jest.runOnlyPendingTimers();
    expect(mockPush).toHaveBeenCalledWith('/auth/verify-email?email=user%40example.com');
  });

  it('shows API errors returned by the client', async () => {
    mockRegister.mockRejectedValue(new Error('Registration failed'));
    render(<RegisterPage />);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/registration failed/i)).toBeInTheDocument();
  });
});
