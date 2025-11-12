import React from 'react';
import { act, render, screen } from '@testing-library/react';
import AnalyticsVisualizations from '@/app/dashboard/analytics/components/AnalyticsVisualizations';

const timeSeries = [
  { date: '2024-01-01', views: 150 },
  { date: '2024-01-02', views: 75 },
];

const contentDistribution = [
  { type: 'blog', value: 10 },
  { type: 'video', value: 5 },
];

const tagDistribution = [
  { tag: 'aws', count: 6 },
  { tag: 'lambda', count: 4 },
];

const topContent = [
  { id: '1', title: 'Deep dive', contentType: 'blog', views: 1200 },
  { id: '2', title: 'Workshop', contentType: 'video', views: 800 },
];

type MatchMediaMockOptions = {
  matches: boolean;
  legacy?: boolean;
};

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function mockMatchMedia({ matches, legacy }: MatchMediaMockOptions) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  const legacyListeners: Array<(event: MediaQueryListEvent) => void> = [];

  const mediaQueryList: Partial<MediaQueryList> = {
    matches,
    media: '(min-width: 1024px)',
    addEventListener: legacy
      ? undefined
      : (_event, listener) => {
          listeners.push(listener as (event: MediaQueryListEvent) => void);
        },
    removeEventListener: legacy
      ? undefined
      : (_event, listener) => {
          const idx = listeners.indexOf(listener as (event: MediaQueryListEvent) => void);
          if (idx >= 0) listeners.splice(idx, 1);
        },
    addListener: legacy
      ? listener => {
          legacyListeners.push(listener);
        }
      : undefined,
    removeListener: legacy
      ? listener => {
          const idx = legacyListeners.indexOf(listener);
          if (idx >= 0) legacyListeners.splice(idx, 1);
        }
      : undefined,
  };

  window.matchMedia = jest.fn().mockReturnValue(mediaQueryList);

  return {
    mediaQueryList,
    listeners,
    legacyListeners,
  };
}

describe('AnalyticsVisualizations', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders empty states when no analytics data is available', () => {
    render(
      <AnalyticsVisualizations
        timeSeries={[]}
        contentDistribution={[]}
        topTags={[]}
        topContent={[]}
        groupBy="day"
      />
    );

    expect(screen.getByText(/No analytics data/i)).toBeInTheDocument();
    expect(screen.getByText(/Add content/i)).toBeInTheDocument();
    expect(screen.getByText(/No tag analytics/i)).toBeInTheDocument();
    expect(screen.getByText(/Performance metrics unavailable/i)).toBeInTheDocument();
  });

  it('renders charts and top content entries when analytics data exists', () => {
    mockMatchMedia({ matches: true });

    render(
      <AnalyticsVisualizations
        timeSeries={timeSeries}
        contentDistribution={contentDistribution}
        topTags={tagDistribution}
        topContent={topContent}
        groupBy="week"
      />
    );

    expect(screen.getByTestId('analytics-overview-grid')).toHaveAttribute('data-layout', 'desktop');
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    expect(screen.getByText(/Deep dive/)).toBeInTheDocument();
  });

  it('defaults to desktop layout when matchMedia is unavailable', () => {
    const storedMatchMedia = window.matchMedia;
    // @ts-expect-error - reassigning for coverage scenario
    window.matchMedia = undefined;

    render(
      <AnalyticsVisualizations
        timeSeries={timeSeries}
        contentDistribution={contentDistribution}
        topTags={tagDistribution}
        topContent={topContent}
        groupBy="week"
      />
    );

    expect(screen.getByTestId('analytics-overview-grid')).toHaveAttribute('data-layout', 'desktop');

    window.matchMedia = storedMatchMedia;
  });

  it('switches layouts when viewport media query changes', () => {
    const { listeners } = mockMatchMedia({ matches: false });

    render(
      <AnalyticsVisualizations
        timeSeries={timeSeries}
        contentDistribution={contentDistribution}
        topTags={tagDistribution}
        topContent={topContent}
        groupBy="day"
      />
    );

    const overviewGrid = screen.getByTestId('analytics-overview-grid');
    expect(overviewGrid).toHaveAttribute('data-layout', 'mobile');

    act(() => {
      listeners[0]?.({ matches: true } as MediaQueryListEvent);
    });

    expect(overviewGrid).toHaveAttribute('data-layout', 'desktop');
  });

  it('registers legacy media query listeners when addEventListener is unavailable', () => {
    const { legacyListeners, mediaQueryList } = mockMatchMedia({ matches: true, legacy: true });

    render(
      <AnalyticsVisualizations
        timeSeries={timeSeries}
        contentDistribution={contentDistribution}
        topTags={tagDistribution}
        topContent={topContent}
        groupBy="month"
      />
    );

    expect(legacyListeners.length).toBeGreaterThan(0);
    expect(mediaQueryList.addListener).toBeDefined();
  });

  it('clamps sparkline coordinates when provided invalid view counts', () => {
    mockMatchMedia({ matches: true });

    render(
      <AnalyticsVisualizations
        timeSeries={[{ date: '2024-01-01', views: Number.NaN }, { date: '2024-01-02', views: Infinity }]}
        contentDistribution={contentDistribution}
        topTags={tagDistribution}
        topContent={topContent}
        groupBy="day"
      />
    );

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('handles zero-value tag distributions without NaN percentages', () => {
    mockMatchMedia({ matches: true });

    render(
      <AnalyticsVisualizations
        timeSeries={timeSeries}
        contentDistribution={contentDistribution}
        topTags={[
          { tag: 'empty', count: 0 },
          { tag: 'none', count: 0 },
        ]}
        topContent={topContent}
        groupBy="day"
      />
    );

    expect(screen.getByText(/empty/i)).toBeInTheDocument();
    expect(screen.getAllByText(/0\.0%/i).length).toBeGreaterThan(0);
  });
});
