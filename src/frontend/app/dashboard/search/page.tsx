'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

const SearchPageClient = dynamic(() => import('./SearchPageClient'), {
  ssr: false,
  loading: () => (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading search...</p>
      </div>
    </div>
  ),
});

const LoadingState = () => (
  <div className="container mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      <p className="mt-4 text-gray-600">Loading search...</p>
    </div>
  </div>
);

export default function AuthenticatedSearchPage(): JSX.Element {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    if (!token) {
      setAuthState('unauthenticated');
      router.push('/auth/login');
      return;
    }
    setAuthState('authenticated');
  }, [router]);

  if (authState === 'authenticated') {
    return <SearchPageClient />;
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <p className="text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return <LoadingState />;
}
