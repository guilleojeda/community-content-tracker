import { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import { getPublicApiClient } from '@/api/client';
import type { ApiError } from '@/api/client';
import type { User } from '@shared/types';

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
export async function generateStaticParams(): Promise<Array<{ username: string }>> {
  // Return empty array - all profile routes will be handled client-side
  // This satisfies Next.js static export requirements
  return [];
}

export const dynamicParams = false;

const ProfileClient = dynamic(() => import('./ProfileClient'), {
  ssr: false,
  loading: () => (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-aws-blue mx-auto mb-4"></div>
          <p className="text-gray-600">Loading profile...</p>
        </div>
      </div>
    </div>
  ),
});

async function loadInitialUser(username: string): Promise<User> {
  let capturedError: ApiError | undefined;
  const client = getPublicApiClient({
    onError: (error) => {
      capturedError = error;
    },
  });

  try {
    return await client.getUserByUsername(username);
  } catch (error) {
    if (capturedError?.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const initialUser = await loadInitialUser(params.username);
  return <ProfileClient params={params} initialUser={initialUser} />;
}
