import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProfilePage from '@/app/profile/[username]/page';
import { loadPublicApiClient } from '@/lib/api/lazyClient';
import { useParams } from 'next/navigation';
import type { User } from '@shared/types';
import { Visibility } from '@shared/types';

jest.mock('@/lib/api/lazyClient', () => ({
  loadPublicApiClient: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('next/dynamic', () => {
  const React = require('react');
  return () => () => React.createElement('div', { 'data-testid': 'profile-content-section' });
});

describe('profile route page', () => {
  const mockClient = {
    getUserByUsername: jest.fn(),
    getUserBadgesByUserId: jest.fn(),
    getUserContent: jest.fn(),
  };

  const baseUser: User = {
    id: 'user-1',
    cognitoSub: 'cognito-1',
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  const loadPublicApiClientMock = loadPublicApiClient as jest.Mock;
  const useParamsMock = useParams as jest.Mock;

  let capturedOnError: ((error: any) => void) | undefined;

  beforeEach(() => {
    capturedOnError = undefined;
    mockClient.getUserByUsername.mockReset();
    mockClient.getUserBadgesByUserId.mockReset();
    mockClient.getUserContent.mockReset();
    mockClient.getUserBadgesByUserId.mockResolvedValue([]);
    mockClient.getUserContent.mockResolvedValue({ content: [], total: 0 });
    loadPublicApiClientMock.mockImplementation(
      async (config?: { onError?: (error: any) => void }) => {
        capturedOnError = config?.onError;
        return mockClient;
      }
    );
  });

  it('renders the profile client when user exists', async () => {
    useParamsMock.mockReturnValue({ username: 'testuser' });
    mockClient.getUserByUsername.mockResolvedValue(baseUser);

    render(<ProfilePage params={{ username: 'testuser' }} />);

    await waitFor(() => {
      expect(mockClient.getUserByUsername).toHaveBeenCalledWith('testuser');
    });

    expect(await screen.findByRole('heading', { name: baseUser.username })).toBeInTheDocument();
    expect(screen.getByTestId('profile-content-section')).toBeInTheDocument();
  });

  it('renders not-found state when the user does not exist', async () => {
    useParamsMock.mockReturnValue({ username: 'ghost' });
    mockClient.getUserByUsername.mockImplementation(async () => {
      capturedOnError?.({ code: 'NOT_FOUND', message: 'missing' });
      throw new Error('missing');
    });

    render(<ProfilePage params={{ username: 'ghost' }} />);

    await waitFor(() => {
      expect(screen.getByText(/profile not found/i)).toBeInTheDocument();
    });
  });
});
