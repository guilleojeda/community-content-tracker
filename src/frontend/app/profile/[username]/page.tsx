import { Metadata } from 'next';
import ProfileClient from './ProfileClient';
import { getPublicApiClient } from '@/api/client';
import type { ApiError } from '@/api/client';

interface ProfilePageProps {
  params: {
    username: string;
  };
}

// Generate metadata for SEO
export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  let capturedError: ApiError | undefined;
  const client = getPublicApiClient({
    onError: (error) => {
      capturedError = error;
    },
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

// Generate static params for build - returns empty array as profiles are fetched client-side
export function generateStaticParams() {
  // Return empty array - all profile routes will be handled client-side
  // This satisfies Next.js static export requirements
  return [];
}

export const dynamicParams = true;

export default function ProfilePage({ params }: ProfilePageProps) {
  return <ProfileClient params={params} />;
}
