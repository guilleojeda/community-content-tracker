import React from 'react';
import { render, screen } from '@testing-library/react';
import { Visibility } from '@shared/types';
import VisibilityChart from '@/app/dashboard/components/VisibilityChart';

describe('VisibilityChart', () => {
  it('renders fallback text when no slices provided', () => {
    render(<VisibilityChart data={[]} />);
    expect(screen.getByText(/No data to display/i)).toBeInTheDocument();
  });

  it('renders chart rows and calculates percentages for provided slices', () => {
    const data = [
      { name: Visibility.PUBLIC, value: 75 },
      { name: 'custom_channel', value: 25 },
    ];

    render(<VisibilityChart data={data} />);

    expect(screen.getByTestId('visibility-chart')).toBeInTheDocument();
    expect(screen.getByText(/public/i)).toBeInTheDocument();
    expect(screen.getByText(/75 · 75%/)).toBeInTheDocument();
    expect(screen.getByText(/custom channel/i)).toBeInTheDocument();
    expect(screen.getByText(/25 · 25%/)).toBeInTheDocument();
  });

  it('avoids division by zero when all values are zero', () => {
    const data = [
      { name: Visibility.AWS_COMMUNITY, value: 0 },
      { name: Visibility.AWS_ONLY, value: 0 },
    ];

    render(<VisibilityChart data={data} />);

    expect(screen.getAllByText(/0 · 0%/)).toHaveLength(2);
  });
});
