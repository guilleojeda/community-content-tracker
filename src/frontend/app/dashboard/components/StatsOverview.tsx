'use client';

import Link from 'next/link';
import { ContentType } from '@shared/types';

interface StatsOverviewProps {
  totalEngagement: number;
  topMetrics: Array<{ metric: string; value: number }>;
  totalContent: number;
  contentCounts: Record<ContentType, number>;
  totalViews: number;
}

const CONTENT_CARDS: Array<{ type: ContentType; label: string }> = [
  { type: ContentType.BLOG, label: 'Blogs' },
  { type: ContentType.GITHUB, label: 'GitHub' },
  { type: ContentType.CONFERENCE_TALK, label: 'Conference Talks' },
  { type: ContentType.PODCAST, label: 'Podcasts' },
];

export default function StatsOverview({
  totalEngagement,
  topMetrics,
  totalContent,
  contentCounts,
  totalViews,
}: StatsOverviewProps): JSX.Element {
  const topThree = topMetrics.slice(0, 3);

  return (
    <div data-testid="stats-overview" className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow" data-testid="total-engagement-card">
          <h3 className="text-gray-500 text-sm font-medium">Total Engagement</h3>
          <p className="text-3xl font-bold mt-2">{totalEngagement}</p>
          {topThree.length > 0 ? (
            <dl className="mt-3 space-y-1 text-sm text-gray-600">
              {topThree.map(({ metric, value }) => (
                <div key={metric} className="flex justify-between">
                  <dt className="capitalize">{metric.replace(/_/g, ' ')}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-gray-500">No engagement data yet</p>
          )}
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm font-medium">Total Content</h3>
          <p className="text-3xl font-bold mt-2">{totalContent}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm font-medium">Total Views</h3>
          <p className="text-3xl font-bold mt-2">{totalViews}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm font-medium">Blogs</h3>
          <p className="text-3xl font-bold mt-2">{contentCounts[ContentType.BLOG] || 0}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-4 mt-4">
        {CONTENT_CARDS.slice(1).map(card => (
          <div key={card.type} className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">{card.label}</h3>
            <p className="text-3xl font-bold mt-2">{contentCounts[card.type] || 0}</p>
          </div>
        ))}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm font-medium">Analytics</h3>
          <p className="mt-2 text-sm text-gray-500">
            Explore time series charts, top tags, and export-ready performance data.
          </p>
          <Link
            href="/dashboard/analytics"
            className="mt-4 inline-flex items-center rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Open Analytics Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
