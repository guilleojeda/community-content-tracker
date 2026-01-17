import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfilePageClient from '@/app/profile/[username]/ProfilePageClient';
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

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('ProfilePageClient', () => {
  let capturedOnError: ((error: any) => void) | undefined;

  beforeEach(() => {
    capturedOnError = undefined;
    document.title = 'initial';
    mockClient.getUserByUsername.mockReset();
    mockClient.getUserBadgesByUserId.mockReset();
    mockClient.getUserContent.mockReset();
    mockClient.getUserBadgesByUserId.mockResolvedValue([]);
    mockClient.getUserContent.mockResolvedValue({ content: [] });
    loadPublicApiClientMock.mockImplementation(
      async (config?: { onError?: (error: any) => void }) => {
        capturedOnError = config?.onError;
        return mockClient;
      }
    );
  });

  it('renders not-found state when username is missing', async () => {
    useParamsMock.mockReturnValue({});

    render(<ProfilePageClient />);

    await waitFor(() => {
      expect(screen.getByText(/profile not found/i)).toBeInTheDocument();
    });
    expect(document.title).toBe('Profile Not Found - AWS Community Hub');
    expect(capturedOnError).toBeUndefined();
  });

  it('renders error state when profile load fails', async () => {
    useParamsMock.mockReturnValue({ username: 'broken' });
    mockClient.getUserByUsername.mockRejectedValue(new Error('boom'));

    render(<ProfilePageClient />);

    expect(await screen.findByText(/unable to load profile/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(document.title).toBe('AWS Community Hub - Profile');
  });

  it('does not update state after unmount on success', async () => {
    useParamsMock.mockReturnValue({ username: 'testuser' });
    const deferred = createDeferred<User>();
    mockClient.getUserByUsername.mockReturnValue(deferred.promise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<ProfilePageClient />);
    unmount();

    await act(async () => {
      deferred.resolve(baseUser);
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not update state after unmount on failure', async () => {
    useParamsMock.mockReturnValue({ username: 'testuser' });
    const deferred = createDeferred<User>();
    mockClient.getUserByUsername.mockReturnValue(deferred.promise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<ProfilePageClient />);
    unmount();

    await act(async () => {
      deferred.reject(new Error('boom'));
      await deferred.promise.catch(() => undefined);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
