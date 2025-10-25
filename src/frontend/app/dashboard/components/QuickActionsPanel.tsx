'use client';

import Link from 'next/link';

export default function QuickActionsPanel(): JSX.Element {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
      <div className="space-y-2">
        <Link
          href="/dashboard/content"
          className="block w-full bg-blue-600 text-white text-center px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Content
        </Link>
        <Link
          href="/dashboard/channels"
          className="block w-full bg-gray-600 text-white text-center px-4 py-2 rounded hover:bg-gray-700"
        >
          Manage Channels
        </Link>
      </div>
    </div>
  );
}
