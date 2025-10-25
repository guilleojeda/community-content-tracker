import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import SettingsPage from '@/app/dashboard/settings/page';
import { Visibility, User, MfaSetupResponse, UpdatePreferencesResponse, ChangePasswordResponse, UpdatePreferencesRequest, UpdateUserRequest } from '@/shared/types';

jest.mock('next/image', () => ({ src, alt, unoptimized, priority, ...rest }: any) => (
  <img data-next-image="true" src={src} alt={alt} {...rest} />
));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

const mockApiClient = {
  getCurrentUser: jest.fn<Promise<User>, []>(),
  updateUserProfile: jest.fn<Promise<User>, [string, UpdateUserRequest]>(),
  changePassword: jest.fn<Promise<ChangePasswordResponse>, [string, { currentPassword: string; newPassword: string }]>(),
  setupMfa: jest.fn<Promise<MfaSetupResponse>, [string]>(),
  updatePreferences: jest.fn<Promise<UpdatePreferencesResponse>, [string, UpdatePreferencesRequest]>(),
  exportUserData: jest.fn<Promise<any>, []>(),
  deleteAccount: jest.fn<Promise<any>, []>(),
  manageConsent: jest.fn(),
};

jest.mock('@/api/client', () => ({
  getAuthenticatedApiClient: jest.fn(() => mockApiClient),
}));

const defaultUser: User = {
  id: 'user-1',
  cognitoSub: 'cognito-1',
  email: 'user@example.com',
  username: 'testuser',
  profileSlug: 'testuser',
  defaultVisibility: Visibility.PUBLIC,
  isAdmin: false,
  isAwsEmployee: false,
  socialLinks: {
    twitter: 'https://twitter.com/testuser',
    linkedin: 'https://linkedin.com/in/testuser',
  },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
};

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

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const mockPush = jest.fn();

const setupPage = async () => {
  (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  mockApiClient.getCurrentUser.mockResolvedValue(defaultUser);
  render(<SettingsPage />);
  await waitFor(() => expect(mockApiClient.getCurrentUser).toHaveBeenCalled());
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
  localStorageMock.setItem('accessToken', 'token');
  (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  global.URL.createObjectURL = jest.fn(() => 'blob:url');
  global.URL.revokeObjectURL = jest.fn();
  global.confirm = jest.fn(() => true);
  mockPush.mockReset();
  Object.values(mockApiClient).forEach((fn) => {
    (fn as jest.Mock).mockReset();
  });
  mockApiClient.getCurrentUser.mockResolvedValue(defaultUser);
});

describe('SettingsPage', () => {
  it('loads user profile and renders sections', async () => {
    await setupPage();

    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^security$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^privacy$/i })).toBeInTheDocument();
    expect(screen.getByText(/^data$/i)).toBeInTheDocument();
  });

  it('shows unauthorized error when no token available', async () => {
    localStorageMock.clear();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
    });
  });

  it('updates profile through API client', async () => {
    mockApiClient.updateUserProfile.mockResolvedValue({ ...defaultUser, username: 'updated', bio: 'New bio' });

    await setupPage();

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'updated' } });
    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: 'New bio' } });

    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(mockApiClient.updateUserProfile).toHaveBeenCalledWith(
        defaultUser.id,
        expect.objectContaining({ email: defaultUser.email, username: 'updated' })
      );
      expect(screen.getByText(/profile updated successfully/i)).toBeInTheDocument();
    });
  });

  it('updates email and notifies user to verify change', async () => {
    const updatedEmail = 'new-email@example.com';
    mockApiClient.updateUserProfile.mockResolvedValue({ ...defaultUser, email: updatedEmail });

    await setupPage();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: updatedEmail } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(mockApiClient.updateUserProfile).toHaveBeenCalledWith(
        defaultUser.id,
        expect.objectContaining({ email: updatedEmail })
      );
      expect(
        screen.getByText(/please verify your new email address/i)
      ).toBeInTheDocument();
    });
  });

  it('saves social links updates', async () => {
    mockApiClient.updateUserProfile.mockResolvedValue({
      ...defaultUser,
      socialLinks: {
        twitter: 'https://twitter.com/newuser',
        linkedin: 'https://linkedin.com/in/newuser',
        github: 'https://github.com/newuser',
        website: 'https://example.com',
      },
    });

    await setupPage();

    fireEvent.change(screen.getByLabelText(/twitter url/i), { target: { value: 'https://twitter.com/newuser' } });
    fireEvent.change(screen.getByLabelText(/linkedin url/i), { target: { value: 'https://linkedin.com/in/newuser' } });
    fireEvent.change(screen.getByLabelText(/github url/i), { target: { value: 'https://github.com/newuser' } });
    fireEvent.change(screen.getByLabelText(/website url/i), { target: { value: 'https://example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(mockApiClient.updateUserProfile).toHaveBeenCalledWith(
        defaultUser.id,
        expect.objectContaining({
          socialLinks: {
            twitter: 'https://twitter.com/newuser',
            linkedin: 'https://linkedin.com/in/newuser',
            github: 'https://github.com/newuser',
            website: 'https://example.com',
          },
        })
      );
    });
  });

  it('validates password strength before invoking API', async () => {
    await setupPage();

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 12 characters long/i)).toBeInTheDocument();
      expect(mockApiClient.changePassword).not.toHaveBeenCalled();
    });
  });

  it('calls changePassword on valid submission', async () => {
    mockApiClient.changePassword.mockResolvedValue({ message: 'Password changed' });

    await setupPage();

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'NewPassword123!' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(mockApiClient.changePassword).toHaveBeenCalledWith(defaultUser.id, expect.objectContaining({ newPassword: 'NewPassword123!' }));
      expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument();
    });
  });

  it('enables MFA and displays secret details', async () => {
    mockApiClient.setupMfa.mockResolvedValue({ qrCode: 'qr', secret: 'secret' });

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /enable mfa/i }));

    await waitFor(() => {
      expect(mockApiClient.setupMfa).toHaveBeenCalledWith(defaultUser.id);
      expect(screen.getByText(/scan this qr code/i)).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /mfa qr code/i })).toHaveAttribute('data-next-image', 'true');
    });
  });

  it('shows unauthorized error when enabling MFA without token', async () => {
    await setupPage();
    window.localStorage.clear();

    fireEvent.click(screen.getByRole('button', { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.setupMfa).not.toHaveBeenCalled();
    });
  });

  it('updates notification preferences', async () => {
    mockApiClient.updatePreferences.mockResolvedValue({ message: 'Preferences updated' });

    await setupPage();

    fireEvent.click(screen.getByRole('checkbox', { name: /newsletter/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(mockApiClient.updatePreferences).toHaveBeenCalledWith(defaultUser.id, expect.objectContaining({ receiveNewsletter: true }));
      expect(screen.getByText(/preferences updated successfully/i)).toBeInTheDocument();
    });
  });

  it('prevents preference updates without token', async () => {
    await setupPage();
    window.localStorage.clear();

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.updatePreferences).not.toHaveBeenCalled();
    });
  });

  it('exports user data to a downloadable file', async () => {
    mockApiClient.exportUserData.mockResolvedValue({ user: defaultUser, content: [], badges: [] });

    await setupPage();

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /export my data/i }));
    });

    await waitFor(() => {
      expect(mockApiClient.exportUserData).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    clickSpy.mockRestore();
  });

  it('handles export errors gracefully', async () => {
    mockApiClient.exportUserData.mockRejectedValueOnce(new Error('Export failed'));

    await setupPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /export my data/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument();
    });
  });

  it('deletes account after confirmation', async () => {
    (global.confirm as jest.Mock).mockReturnValue(true);
    mockApiClient.deleteAccount.mockResolvedValue({ message: 'deleted' });

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));

    await waitFor(() => {
      expect(mockApiClient.deleteAccount).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('does not delete account when user cancels confirmation', async () => {
    (global.confirm as jest.Mock).mockReturnValue(false);

    await setupPage();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));

    expect(mockApiClient.deleteAccount).not.toHaveBeenCalled();
  });

  it('renders API errors from client operations', async () => {
    mockApiClient.getCurrentUser.mockRejectedValueOnce(new Error('Failed to fetch user data'));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch user data/i)).toBeInTheDocument();
    });
  });

  it('prevents profile update when token is missing', async () => {
    await setupPage();

    window.localStorage.clear();

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'attempt' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.updateUserProfile).not.toHaveBeenCalled();
    });
  });

  it('notifies when confirmation password does not match', async () => {
    await setupPage();

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'Mismatch123!' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      expect(mockApiClient.changePassword).not.toHaveBeenCalled();
    });
  });

  it('displays profile update errors from the API', async () => {
    mockApiClient.updateUserProfile.mockRejectedValueOnce(new Error('Update failed'));

    await setupPage();

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'broken' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/update failed/i)).toBeInTheDocument();
    });
  });

  it.each([
    ['lowercase123!', /uppercase letter/],
    ['UPPERCASE123!', /lowercase letter/],
    ['Password!!!!', /must contain at least one number/i],
    ['Password1234', /special character/i],
  ])('enforces password composition rules for %s', async (pwd, expectedMessage) => {
    await setupPage();

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: pwd } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: pwd } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText(expectedMessage, { selector: 'div' })).toBeInTheDocument();
      expect(mockApiClient.changePassword).not.toHaveBeenCalled();
    });
  });

  it('shows password strength indicator feedback', async () => {
    await setupPage();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'Password123!' } });

    await waitFor(() => {
      expect(screen.getByText(/strong/i)).toBeInTheDocument();
    });
  });

  it('shows medium and weak password strength states', async () => {
    await setupPage();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'Password1234' } });
    await waitFor(() => {
      expect(screen.getByText(/medium/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'aaaaaaaaaaaa' } });
    await waitFor(() => {
      expect(screen.getByText(/weak/i)).toBeInTheDocument();
    });
  });

  it('surfaces MFA enablement errors', async () => {
    mockApiClient.setupMfa.mockRejectedValueOnce(new Error('Failed to enable MFA'));

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to enable mfa/i)).toBeInTheDocument();
    });
  });

  it('prevents MFA enable when session token is missing', async () => {
    await setupPage();

    localStorageMock.clear();
    fireEvent.click(screen.getByRole('button', { name: /enable mfa/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.setupMfa).not.toHaveBeenCalled();
    });
  });

  it('blocks preference save when session is missing', async () => {
    await setupPage();

    localStorageMock.clear();
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.updatePreferences).not.toHaveBeenCalled();
    });
  });

  it('shows preferences error when update fails', async () => {
    mockApiClient.updatePreferences.mockRejectedValueOnce(new Error('Preferences failed'));

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(screen.getByText(/preferences failed/i)).toBeInTheDocument();
    });
  });

  it('prevents data export when session token is missing', async () => {
    await setupPage();

    localStorageMock.clear();
    fireEvent.click(screen.getByRole('button', { name: /export my data/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.exportUserData).not.toHaveBeenCalled();
    });
  });

  it('reports export errors from the server', async () => {
    mockApiClient.exportUserData.mockRejectedValueOnce(new Error('Export failed'));

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /export my data/i }));

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument();
    });
  });

  it('shows unauthorized error when delete account lacks token', async () => {
    await setupPage();

    localStorageMock.clear();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
      expect(mockApiClient.deleteAccount).not.toHaveBeenCalled();
    });
  });

  it('displays delete account errors from API', async () => {
    mockApiClient.deleteAccount.mockRejectedValueOnce(new Error('Delete failed'));

    await setupPage();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));

    await waitFor(() => {
      expect(mockApiClient.deleteAccount).toHaveBeenCalled();
      expect(screen.getByText(/delete failed/i)).toBeInTheDocument();
    });
  });
});
