'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

const DashboardHomeView = dynamic(() => import('./DashboardHomeView'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6 animate-pulse">
        <div className="h-6 w-1/3 bg-gray-200 rounded" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  ),
});

const LoadingState = () => (
  <div className="container mx-auto px-4 py-8">
    <div className="bg-white shadow rounded-lg p-6 animate-pulse">
      <div className="h-6 w-1/3 bg-gray-200 rounded" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 bg-gray-100 rounded" />
        ))}
      </div>
    </div>
  </div>
);

export default function DashboardGate(): JSX.Element {
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
    return <DashboardHomeView />;
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <p className="text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return <LoadingState />;
}
