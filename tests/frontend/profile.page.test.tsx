import React from 'react';
import ProfilePage, { generateMetadata } from '@/app/profile/[username]/page';
import { getPublicApiClient } from '@/api/client';
import { notFound } from 'next/navigation';
import type { User } from '@shared/types';
import { Visibility } from '@shared/types';

jest.mock('@/api/client', () => ({
  getPublicApiClient: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

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

  let capturedOnError: ((error: any) => void) | undefined;

  const getPublicApiClientMock = getPublicApiClient as jest.Mock;
  const notFoundMock = notFound as jest.Mock;

  beforeEach(() => {
    capturedOnError = undefined;
    mockClient.getUserByUsername.mockReset();
    mockClient.getUserBadgesByUserId.mockReset();
    mockClient.getUserContent.mockReset();
    mockClient.getUserBadgesByUserId.mockResolvedValue([]);
    mockClient.getUserContent.mockResolvedValue({ content: [], total: 0 });
    getPublicApiClientMock.mockImplementation((config?: { onError?: (error: any) => void }) => {
      capturedOnError = config?.onError;
      return mockClient;
    });
    notFoundMock.mockClear();
  });

  it('returns the profile client when user exists', async () => {
    mockClient.getUserByUsername.mockResolvedValue(baseUser);

    await expect(ProfilePage({ params: { username: 'testuser' } })).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('invokes notFound when the user does not exist', async () => {
    mockClient.getUserByUsername.mockImplementation(async () => {
      capturedOnError?.({ code: 'NOT_FOUND', message: 'missing' });
      throw new Error('missing');
    });

    await expect(ProfilePage({ params: { username: 'ghost' } })).rejects.toThrow('NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  describe('generateMetadata', () => {
    it('returns user-specific SEO metadata when profile exists', async () => {
      mockClient.getUserByUsername.mockResolvedValue({
        ...baseUser,
        username: 'builder',
        bio: 'AWS Community Builder and blogger',
      });

      const metadata = await generateMetadata({ params: { username: 'builder' } });

      expect(metadata).toMatchObject({
        title: 'builder - AWS Community Hub',
        description: 'builder: AWS Community Builder and blogger',
        openGraph: {
          title: 'builder - AWS Community Hub',
          description: 'builder: AWS Community Builder and blogger',
          type: 'profile',
          siteName: 'AWS Community Hub',
        },
        twitter: {
          card: 'summary',
          title: 'builder - AWS Community Hub',
          description: 'builder: AWS Community Builder and blogger',
        },
      });
    });

    it('returns not-found metadata when user lookup fails with NOT_FOUND', async () => {
      mockClient.getUserByUsername.mockImplementation(async () => {
        capturedOnError?.({ code: 'NOT_FOUND', message: 'missing' });
        throw new Error('missing');
      });

      const metadata = await generateMetadata({ params: { username: 'ghost' } });

      expect(metadata).toMatchObject({
        title: 'Profile Not Found - AWS Community Hub',
        description: 'The requested user profile could not be found.',
      });
    });
  });
});
