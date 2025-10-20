'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { User, Badge, Content, ContentType, Visibility, BadgeType } from '@shared/types';
import { VISIBILITY_COLORS, getBadgeLabel } from '@/lib/constants/ui';
import { getAuthenticatedApiClient } from '@/api/client';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/auth/login');
      return;
    }

    const fetchDashboardData = async () => {
      try {
        const client = getAuthenticatedApiClient();

        const getErrorMessage = (fallback: string, err: unknown) =>
          err instanceof Error && err.message ? err.message : fallback;

        let currentUser: User;
        try {
          currentUser = await client.getCurrentUser();
          setUser(currentUser);
        } catch (err) {
          setError(getErrorMessage('Failed to fetch user', err));
          return;
        }

        try {
          const fetchedBadges = await client.getUserBadges();
          setBadges(fetchedBadges);
        } catch (err) {
          setError(getErrorMessage('Failed to fetch badges', err));
          return;
        }

        try {
          const fetchedContent = await client.listContent({ limit: 100 });
          setContent(fetchedContent.content || []);
        } catch (err) {
          setError(getErrorMessage('Failed to fetch content', err));
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [router]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        <div data-testid="stats-skeleton" className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} data-testid={`stat-card-skeleton-${i}`} className="bg-gray-200 animate-pulse h-24 rounded-lg"></div>
            ))}
          </div>
        </div>
        <div data-testid="content-list-skeleton" className="bg-gray-200 animate-pulse h-64 rounded-lg"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  const contentByType = content.reduce((acc, item) => {
    acc[item.contentType] = (acc[item.contentType] || 0) + 1;
    return acc;
  }, {} as Record<ContentType, number>);

  const visibilityDistribution = content.reduce((acc, item) => {
    acc[item.visibility] = (acc[item.visibility] || 0) + 1;
    return acc;
  }, {} as Record<Visibility, number>);

  const engagementBreakdown = content.reduce((acc, item) => {
    const metrics = item.metrics || {};

    Object.entries(metrics).forEach(([metricKey, metricValue]) => {
      if (typeof metricValue !== 'number' || !isFinite(metricValue)) {
        return;
      }

      const normalizedKey = metricKey.toLowerCase();
      acc[normalizedKey] = (acc[normalizedKey] || 0) + metricValue;
    });

    return acc;
  }, {} as Record<string, number>);

  const prioritizedMetrics = ['views', 'likes', 'stars', 'downloads', 'comments', 'shares'];
  const sortedEngagementEntries = Object.entries(engagementBreakdown)
    .sort((a, b) => {
      const [metricA] = a;
      const [metricB] = b;
      const priorityA = prioritizedMetrics.indexOf(metricA);
      const priorityB = prioritizedMetrics.indexOf(metricB);

      if (priorityA !== -1 || priorityB !== -1) {
        if (priorityA === -1) return 1;
        if (priorityB === -1) return -1;
        return priorityA - priorityB;
      }

      return metricA.localeCompare(metricB);
    });

  const totalViews = engagementBreakdown.views || 0;
  const totalEngagement = sortedEngagementEntries.reduce((sum, [, value]) => sum + value, 0);

  const recentContent = [...content]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const visibilityChartData = Object.entries(visibilityDistribution).map(([key, value]) => ({
    name: key,
    value,
  }));

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {/* Stats Overview */}
      <div data-testid="stats-overview" className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow" data-testid="total-engagement-card">
            <h3 className="text-gray-500 text-sm font-medium">Total Engagement</h3>
            <p className="text-3xl font-bold mt-2">{totalEngagement}</p>
            {sortedEngagementEntries.length > 0 ? (
              <dl className="mt-3 space-y-1 text-sm text-gray-600">
                {sortedEngagementEntries.slice(0, 3).map(([metric, value]) => (
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
            <p className="text-3xl font-bold mt-2">{content.length}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">Total Views</h3>
            <p className="text-3xl font-bold mt-2">{totalViews}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">Blogs</h3>
            <p className="text-3xl font-bold mt-2">{contentByType[ContentType.BLOG] || 0}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-4 mt-4">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">GitHub</h3>
            <p className="text-3xl font-bold mt-2">{contentByType[ContentType.GITHUB] || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">Conference Talks</h3>
            <p className="text-3xl font-bold mt-2">{contentByType[ContentType.CONFERENCE_TALK] || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-500 text-sm font-medium">Podcasts</h3>
            <p className="text-3xl font-bold mt-2">{contentByType[ContentType.PODCAST] || 0}</p>
          </div>
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

      {/* Dashboard Grid */}
      <div data-testid="dashboard-grid" className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Content */}
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Recent Content</h2>
            {content.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No content yet!</p>
                <p className="text-gray-400 text-sm mt-2">Get started by adding your first content</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentContent.map((item) => (
                  <div key={item.id} data-testid="content-item" className="border-b pb-4 last:border-b-0">
                    <h3 className="font-medium">{item.title}</h3>
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">{item.contentType}</span>
                      <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">{item.visibility}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* AWS Badges */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">AWS Badges</h2>
            {user?.isAwsEmployee && (
              <div className="mb-3">
                <span className="inline-block bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">
                  AWS Employee
                </span>
              </div>
            )}
            {badges.length > 0 ? (
              <div className="space-y-2">
                {badges.map((badge) => (
                  <div key={badge.id} className="inline-block mr-2 mb-2">
                    <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium">
                      {getBadgeLabel(badge.badgeType)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              !user?.isAwsEmployee && <p className="text-gray-500 text-sm">No badges yet</p>
            )}
          </div>

          {/* Visibility Distribution */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Visibility Distribution</h2>
            {content.length > 0 ? (
              <div data-testid="visibility-chart">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={visibilityChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {visibilityChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={VISIBILITY_COLORS[entry.name as Visibility]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No data to display</p>
            )}
          </div>

          {/* Quick Actions */}
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
        </div>
      </div>
    </div>
  );
}
