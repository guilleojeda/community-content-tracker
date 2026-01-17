'use client';

import React from 'react';
import type { PlatformStats } from '@aws-community-hub/shared';

type StatsSectionProps = {
  stats: PlatformStats | null;
  loading: boolean;
};

export default function StatsSection({ stats, loading }: StatsSectionProps) {
  if (!loading && !stats) {
    return null;
  }

  return (
    <section className="py-16 bg-gray-100">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-12">Platform Stats</h2>
        {loading ? (
          <div className="text-center text-gray-600">Loading statistics...</div>
        ) : stats ? (
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold text-aws-orange-dark mb-2">
                {stats.topContributors?.toLocaleString() ?? 0}+
              </div>
              <div className="text-gray-600">Contributors</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-aws-orange-dark mb-2">
                {stats.totalContent?.toLocaleString() ?? 0}+
              </div>
              <div className="text-gray-600">Content Pieces</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-aws-orange-dark mb-2">
                {stats.recentActivity?.last24h?.toLocaleString() ?? 0}+
              </div>
              <div className="text-gray-600">Last 24 Hours</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-aws-orange-dark mb-2">
                {stats.totalUsers?.toLocaleString() ?? 0}+
              </div>
              <div className="text-gray-600">Registered Users</div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
