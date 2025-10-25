'use client';

import React from 'react';
import { EmptyState } from './EmptyState';

interface TimeSeriesPoint {
  date: string;
  views: number;
}

interface DistributionPoint {
  type: string;
  value: number;
}

interface TagDistribution {
  tag: string;
  count: number;
}

interface TopContentEntry {
  id: string;
  title: string;
  contentType: string;
  views: number;
}

interface AnalyticsVisualizationsProps {
  timeSeries: TimeSeriesPoint[];
  contentDistribution: DistributionPoint[];
  topTags: TagDistribution[];
  topContent: TopContentEntry[];
  groupBy: 'day' | 'week' | 'month';
}

const CHART_COLORS = ['#2563eb', '#16a34a', '#f97316', '#a855f7', '#f43f5e', '#14b8a6'];

function Sparkline({ data }: { data: TimeSeriesPoint[] }): JSX.Element {
  if (data.length === 0) {
    return <EmptyState message="No analytics data for the selected range." />;
  }

  const maxViews = Math.max(...data.map(point => point.views), 1);
  const width = Math.max(data.length - 1, 1) * 60;
  const height = 180;
  const points = data
    .map((point, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - (point.views / maxViews) * height;
      return `${x},${Number.isFinite(y) ? y : height}`;
    })
    .join(' ');

  return (
    <div data-testid="line-chart" className="h-64 w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label="Sparkline showing content views over time"
      >
        <polyline fill="none" stroke="#2563eb" strokeWidth={3} points={points} />
        {data.map((point, index) => {
          const x = (index / Math.max(data.length - 1, 1)) * width;
          const y = height - (point.views / maxViews) * height;
          return <circle key={point.date} cx={x} cy={Number.isFinite(y) ? y : height} r={4} fill="#2563eb" />;
        })}
      </svg>
    </div>
  );
}

function DistributionBars({ data }: { data: DistributionPoint[] }): JSX.Element {
  if (data.length === 0) {
    return <EmptyState message="Add content to view channel performance." />;
  }

  const maxValue = Math.max(...data.map(item => item.value), 1);

  return (
    <div data-testid="bar-chart" className="flex h-64 items-end gap-6">
      {data.map(item => {
        const heightPercent = (item.value / maxValue) * 100;
        return (
          <div key={item.type} className="flex w-16 flex-col items-center text-sm">
            <div
              className="w-full rounded-t-md bg-emerald-500"
              style={{ height: `${heightPercent}%` }}
              aria-label={`${item.type} content count ${item.value}`}
            />
            <span className="mt-3 break-words text-center text-xs text-gray-600">
              {item.type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs font-semibold text-gray-900">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function TopicPie({ data }: { data: TagDistribution[] }): JSX.Element {
  if (data.length === 0) {
    return <EmptyState message="No tag analytics available yet." />;
  }

  const total = data.reduce((sum, tag) => sum + tag.count, 0) || 1;
  let current = 0;
  const slices = data.map((tag, index) => {
    const start = current;
    const slice = (tag.count / total) * 100;
    current += slice;
    return {
      label: tag.tag,
      start,
      end: current,
      color: CHART_COLORS[index % CHART_COLORS.length],
      count: tag.count,
    };
  });

  const gradient = slices
    .map(slice => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`)
    .join(', ');

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center" data-testid="pie-chart">
      <div
        className="mx-auto h-52 w-52 rounded-full border border-gray-200 shadow-inner"
        style={{ backgroundImage: `conic-gradient(${gradient})` }}
        role="img"
        aria-label="Topic distribution pie chart"
      />
      <ul className="flex-1 space-y-2 text-sm">
        {slices.map(slice => (
          <li key={slice.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
              <span className="font-medium text-gray-800">{slice.label}</span>
            </div>
            <span className="text-gray-600">
              {slice.count} ({((slice.end - slice.start) || 0).toFixed(1)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyticsVisualizations({
  timeSeries,
  contentDistribution,
  topTags,
  topContent,
  groupBy,
}: AnalyticsVisualizationsProps): JSX.Element {

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Content Views Over Time</h2>
          <p className="text-sm text-gray-500">Engagement trend grouped by {groupBy}.</p>
          <div className="mt-4">
            <Sparkline data={timeSeries} />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Channel Performance</h2>
          <p className="text-sm text-gray-500">Distribution of content types published on the platform.</p>
          <div className="mt-4">
            <DistributionBars data={contentDistribution} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Topic Distribution</h2>
          <p className="text-sm text-gray-500">Top tags across your published content.</p>
          <div className="mt-4">
            <TopicPie data={topTags} />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Top Performing Content</h2>
          <p className="text-sm text-gray-500">Content items ranked by total views.</p>
          <div className="mt-4 space-y-3">
            {topContent.length === 0 && (
              <EmptyState message="Performance metrics unavailable for the selected range." />
            )}
            {topContent.map(item => (
              <div key={item.id} className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">{item.title}</p>
                <p className="text-xs text-gray-500">
                  {item.contentType} · {item.views.toLocaleString()} views
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export default AnalyticsVisualizations;
