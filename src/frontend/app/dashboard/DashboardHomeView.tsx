'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { User, Badge, Content, ContentType, Visibility } from '@shared/types';
const getAuthenticatedApiClient = async () => {
  const { loadAuthenticatedApiClient } = await import('@/lib/api/lazyClient');
  return loadAuthenticatedApiClient();
};

const StatsOverview = dynamic(() => import('./components/StatsOverview'), {
  ssr: false,
  loading: () => (
    <div data-testid="stats-skeleton" className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-200 animate-pulse h-24 rounded-lg" />
        ))}
      </div>
    </div>
  ),
});

const RecentContentList = dynamic(() => import('./components/RecentContentList'), {
  ssr: false,
  loading: () => <div data-testid="content-list-skeleton" className="bg-gray-200 animate-pulse h-64 rounded-lg" />,
});

const BadgeSummary = dynamic(() => import('./components/BadgeSummary'), {
  ssr: false,
  loading: () => <div className="bg-white p-6 rounded-lg shadow animate-pulse h-36" />,
});

const VisibilityPanel = dynamic(() => import('./components/VisibilityPanel'), {
  ssr: false,
  loading: () => <div className="bg-white p-6 rounded-lg shadow animate-pulse h-48" />,
});

const QuickActionsPanel = dynamic(() => import('./components/QuickActionsPanel'), {
  ssr: false,
  loading: () => <div className="bg-white p-6 rounded-lg shadow animate-pulse h-40" />,
});

const PRIORITIZED_METRICS = ['views', 'likes', 'stars', 'downloads', 'comments', 'shares'];

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
        const client = await getAuthenticatedApiClient();

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

  const contentByType = useMemo(
    () =>
      content.reduce((acc, item) => {
        acc[item.contentType] = (acc[item.contentType] || 0) + 1;
        return acc;
      }, {} as Record<ContentType, number>),
    [content]
  );

  const visibilityDistribution = useMemo(
    () =>
      content.reduce((acc, item) => {
        acc[item.visibility] = (acc[item.visibility] || 0) + 1;
        return acc;
      }, {} as Record<Visibility, number>),
    [content]
  );

  const engagementBreakdown = useMemo(
    () =>
      content.reduce((acc, item) => {
        const metrics = item.metrics || {};

        Object.entries(metrics).forEach(([metricKey, metricValue]) => {
          if (typeof metricValue !== 'number' || !isFinite(metricValue)) {
            return;
          }

          const normalizedKey = metricKey.toLowerCase();
          acc[normalizedKey] = (acc[normalizedKey] || 0) + metricValue;
        });

        return acc;
      }, {} as Record<string, number>),
    [content]
  );

  const sortedEngagementEntries = useMemo(
    () =>
      Object.entries(engagementBreakdown).sort((a, b) => {
        const [metricA] = a;
        const [metricB] = b;
        const priorityA = PRIORITIZED_METRICS.indexOf(metricA);
        const priorityB = PRIORITIZED_METRICS.indexOf(metricB);

        if (priorityA !== -1 || priorityB !== -1) {
          if (priorityA === -1) return 1;
          if (priorityB === -1) return -1;
          return priorityA - priorityB;
        }

        return metricA.localeCompare(metricB);
      }),
    [engagementBreakdown]
  );

  const totalViews = engagementBreakdown.views || 0;
  const totalEngagement = sortedEngagementEntries.reduce((sum, [, value]) => sum + value, 0);

  const recentContent = useMemo(
    () =>
      [...content]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [content]
  );

  const visibilityChartData = useMemo(
    () =>
      Object.entries(visibilityDistribution).map(([key, value]) => ({
        name: key,
        value,
      })),
    [visibilityDistribution]
  );

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

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      <StatsOverview
        totalEngagement={totalEngagement}
        topMetrics={sortedEngagementEntries.map(([metric, value]) => ({ metric, value }))}
        totalContent={content.length}
        contentCounts={contentByType}
        totalViews={totalViews}
      />

      {/* Dashboard Grid */}
      <div data-testid="dashboard-grid" className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Content */}
        <div className="lg:col-span-2">
          <RecentContentList content={recentContent} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <BadgeSummary user={user} badges={badges} />
          <VisibilityPanel hasContent={content.length > 0} data={visibilityChartData} />
          <QuickActionsPanel />
        </div>
      </div>
    </div>
  );
}
