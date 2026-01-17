'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ApiError } from '@/api/client';
import { loadPublicApiClient } from '@/lib/api/lazyClient';
import type { Badge, Content, User } from '@shared/types';
import { Visibility } from '@shared/types';
import ProfileClient from './ProfileClient';

type ProfileLoadState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; badges: Badge[]; content: Content[] }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

const LoadingState = () => (
  <div className="container mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-md p-8">
      <div className="h-6 w-1/3 bg-gray-200 rounded animate-pulse" />
      <div className="mt-4 space-y-3">
        <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="mt-8 h-40 bg-gray-100 rounded animate-pulse" />
    </div>
  </div>
);

const NotFoundState = () => (
  <div className="container mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-md p-8 text-center">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Profile not found</h1>
      <p className="text-gray-600">We could not find that contributor profile.</p>
      <div className="mt-6">
        <a href="/search" className="text-aws-blue hover:text-aws-orange transition-colors font-medium">
          Back to Search
        </a>
      </div>
    </div>
  </div>
);

const ErrorState = ({ message }: { message: string }) => (
  <div className="container mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-md p-8 text-center">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Unable to load profile</h1>
      <p className="text-gray-600">{message}</p>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center px-4 py-2 bg-aws-blue text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
        >
          Retry
        </button>
      </div>
    </div>
  </div>
);

interface ProfilePageClientProps {
  initialUsername?: string;
}

export default function ProfilePageClient({ initialUsername }: ProfilePageClientProps): JSX.Element {
  const params = useParams<{ username?: string }>();
  const username = useMemo(() => {
    const fromParams = Array.isArray(params?.username) ? params?.username[0] : params?.username;
    const candidate = typeof fromParams === 'string' && fromParams.trim().length > 0
      ? fromParams
      : initialUsername;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }, [params?.username, initialUsername]);

  const [state, setState] = useState<ProfileLoadState>({ status: 'loading' });

  useEffect(() => {
    if (!username) {
      setState({ status: 'not_found' });
      return;
    }

    let cancelled = false;
    let capturedError: ApiError | undefined;

    const loadProfile = async () => {
      setState({ status: 'loading' });
      const client = await loadPublicApiClient({
        onError: (error) => {
          capturedError = error;
        },
      });

      try {
        const user = await client.getUserByUsername(username);
        const [badges, contentData] = await Promise.all([
          client.getUserBadgesByUserId(user.id),
          client.getUserContent(user.id, { visibility: Visibility.PUBLIC }),
        ]);

        if (cancelled) {
          return;
        }

        setState({
          status: 'ready',
          user,
          badges,
          content: contentData.content,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (capturedError?.code === 'NOT_FOUND') {
          setState({ status: 'not_found' });
          return;
        }

        const message = error instanceof Error ? error.message : 'Unexpected error loading profile.';
        setState({ status: 'error', message });
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (state.status === 'ready') {
      document.title = `${state.user.username} - AWS Community Hub`;
      return;
    }

    if (state.status === 'not_found') {
      document.title = 'Profile Not Found - AWS Community Hub';
      return;
    }

    document.title = 'AWS Community Hub - Profile';
  }, [state]);

  if (state.status === 'loading') {
    return <LoadingState />;
  }

  if (state.status === 'not_found') {
    return <NotFoundState />;
  }

  if (state.status === 'error') {
    return <ErrorState message={state.message} />;
  }

  return <ProfileClient user={state.user} badges={state.badges} content={state.content} />;
}
