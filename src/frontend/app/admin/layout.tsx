'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { loadAuthenticatedApiClient } from '@/lib/api/lazyClient';
import type { User } from '@shared/types';
import { AdminContextProvider } from './context';

const AdminShell = dynamic(() => import('./AdminShell'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-pulse text-gray-600">Loading admin console…</div>
    </div>
  ),
});

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        const client = await loadAuthenticatedApiClient();
        const user = await client.getCurrentUser();

        if (!isMounted) {
          return;
        }

        if (!user.isAdmin) {
          setError('Administrator access required');
          router.replace('/dashboard');
          return;
        }

        setCurrentUser(user);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError('Unable to verify administrator access');
        router.replace('/dashboard');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const contextValue = useMemo(() => ({ currentUser }), [currentUser]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-600">Loading admin console…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md rounded-lg bg-white p-6 shadow border border-red-100 text-center">
          <h2 className="text-lg font-semibold text-red-600 mb-2">Access Restricted</h2>
          <p className="text-gray-600">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="mt-4 inline-flex items-center rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminContextProvider value={contextValue}>
      <AdminShell currentUser={currentUser} pathname={pathname}>
        {children}
      </AdminShell>
    </AdminContextProvider>
  );
}
