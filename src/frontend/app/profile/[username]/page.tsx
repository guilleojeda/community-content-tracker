import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ApiError } from '@/api/client';
import type { User } from '@shared/types';
import { Visibility } from '@shared/types';
import ProfileClient from './ProfileClient';

interface ProfilePageProps {
  params: {
    username: string;
  };
}

async function getClientWithErrorCapture(onError: (error: ApiError) => void) {
  const { getPublicApiClient } = await import('@/api/client');
  return getPublicApiClient({
    onError,
  });
}

// Generate metadata for SEO
export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  let capturedError: ApiError | undefined;
  const client = await getClientWithErrorCapture((error) => {
    capturedError = error;
  });

  try {
    const user = await client.getUserByUsername(params.username);
    const title = `${user.username} - AWS Community Hub`;
    const description = user.bio
      ? `${user.username}: ${user.bio.substring(0, 160)}`
      : `View ${user.username}'s AWS community contributions and badges`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'profile',
        siteName: 'AWS Community Hub',
      },
      twitter: {
        card: 'summary',
        title,
        description,
      },
    };
  } catch (error) {
    if (capturedError?.code === 'NOT_FOUND') {
      return {
        title: 'Profile Not Found - AWS Community Hub',
        description: 'The requested user profile could not be found.',
      };
    }

    return {
      title: 'AWS Community Hub - Profile',
      description: 'View AWS community contributor profiles and contributions',
    };
  }
}

// Generate static params for build - profiles remain dynamic
export async function generateStaticParams(): Promise<Array<{ username: string }>> {
  return [];
}

export const dynamicParams = false;

async function fetchProfileData(username: string) {
  let capturedError: ApiError | undefined;
  const client = await getClientWithErrorCapture((error) => {
    capturedError = error;
  });

  try {
    const user = await client.getUserByUsername(username);
    const [badges, contentData] = await Promise.all([
      client.getUserBadgesByUserId(user.id),
      client.getUserContent(user.id, { visibility: Visibility.PUBLIC }),
    ]);
    return { user, badges, content: contentData.content };
  } catch (error) {
    if (capturedError?.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { user, badges, content } = await fetchProfileData(params.username);
  return <ProfileClient user={user} badges={badges} content={content} />;
}
