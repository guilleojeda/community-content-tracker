import React from 'react';
import { render, screen } from '@testing-library/react';
import StatsSection from '@/app/sections/StatsSection';

const baseStats = {
  topContributors: 1250,
  totalContent: 43210,
  totalUsers: 9876,
  recentActivity: {
    last24h: 120,
  },
};

describe('StatsSection', () => {
  it('returns null when not loading and stats are unavailable', () => {
    const { container } = render(<StatsSection stats={null} loading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows loading indicator while stats fetch in progress', () => {
    render(<StatsSection stats={null} loading />);
    expect(screen.getByText(/Loading statistics/i)).toBeInTheDocument();
  });

  it('renders stats grid with fallbacks for missing values', () => {
    const stats = {
      ...baseStats,
      topContributors: undefined,
      recentActivity: { last24h: undefined },
    } as any;

    render(<StatsSection stats={stats} loading={false} />);

    expect(screen.getByText(/Platform Stats/i)).toBeInTheDocument();
    const contributorsValue = screen.getByText(/Contributors/i).previousSibling as HTMLElement;
    const hoursValue = screen.getByText(/Last 24 Hours/i).previousSibling as HTMLElement;
    expect(contributorsValue).toHaveTextContent('0+');
    expect(hoursValue).toHaveTextContent('0+');
    expect(screen.getByText(/Content Pieces/i)).toBeInTheDocument();
    expect(screen.getByText(/Registered Users/i)).toBeInTheDocument();
  });

  it('renders zero fallbacks when aggregate stats are missing', () => {
    const stats = {
      ...baseStats,
      topContributors: undefined,
      totalContent: undefined,
      totalUsers: undefined,
      recentActivity: undefined,
    } as any;

    render(<StatsSection stats={stats} loading={false} />);

    const contributorsValue = screen.getByText(/Contributors/i).previousSibling as HTMLElement;
    const contentValue = screen.getByText(/Content Pieces/i).previousSibling as HTMLElement;
    const hoursValue = screen.getByText(/Last 24 Hours/i).previousSibling as HTMLElement;
    const usersValue = screen.getByText(/Registered Users/i).previousSibling as HTMLElement;

    expect(contributorsValue).toHaveTextContent('0+');
    expect(contentValue).toHaveTextContent('0+');
    expect(hoursValue).toHaveTextContent('0+');
    expect(usersValue).toHaveTextContent('0+');
  });
});
