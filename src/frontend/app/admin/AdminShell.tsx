'use client';

import Link from 'next/link';
import type { User } from '@shared/types';

interface AdminShellProps {
  children: React.ReactNode;
  currentUser: User | null;
  pathname: string | null;
}

const NAVIGATION_LINKS: Array<{ href: string; label: string }> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/audit-log', label: 'Audit Log' },
];

export default function AdminShell({ children, currentUser, pathname }: AdminShellProps): JSX.Element {
  return (
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
  );
}
