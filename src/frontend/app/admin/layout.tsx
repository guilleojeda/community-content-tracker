'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getAuthenticatedApiClient } from '@/api/client';
import type { User } from '@shared/types';
import { AdminContextProvider } from './context';

const NAVIGATION_LINKS: Array<{ href: string; label: string }> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/audit-log', label: 'Audit Log' },
];

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
        const client = getAuthenticatedApiClient();
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
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
              <p className="text-sm text-gray-500">Manage the AWS Community Content Hub</p>
            </div>
            {currentUser && (
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">{currentUser.username}</p>
                <p className="text-xs text-gray-500">{currentUser.email}</p>
              </div>
            )}
          </div>
          <nav className="border-t border-gray-200 bg-white">
            <div className="mx-auto flex max-w-7xl space-x-4 px-4 sm:px-6 lg:px-8">
              {NAVIGATION_LINKS.map(link => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center border-b-2 px-1 pt-4 pb-3 text-sm font-medium ${
                      isActive
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </AdminContextProvider>
  );
}
