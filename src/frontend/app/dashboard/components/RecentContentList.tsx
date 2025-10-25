'use client';

import type { Content } from '@shared/types';

interface RecentContentListProps {
  content: Content[];
}

export default function RecentContentList({ content }: RecentContentListProps): JSX.Element {
  if (content.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Recent Content</h2>
        <div className="text-center py-8">
          <p className="text-gray-500">No content yet!</p>
          <p className="text-gray-400 text-sm mt-2">Get started by adding your first content</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Recent Content</h2>
      <div className="space-y-4">
        {content.map(item => (
          <div key={item.id} data-testid="content-item" className="border-b pb-4 last:border-b-0">
            <h3 className="font-medium">{item.title}</h3>
            <div className="flex gap-2 mt-2">
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">{item.contentType}</span>
              <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">{item.visibility}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
