import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FilterSidebar from '@/app/dashboard/search/FilterSidebar';
import { BadgeType, ContentType, Visibility, SearchFilters } from '@shared/types';

function renderSidebar({
  initialFilters = {},
  onFilterChange = jest.fn(),
  onClearFilters = jest.fn(),
  isOpen = true,
  onClose,
}: {
  initialFilters?: SearchFilters;
  onFilterChange?: (filters: SearchFilters) => void;
  onClearFilters?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
} = {}) {
  const Wrapper = () => {
    const [filters, setFilters] = React.useState<SearchFilters>(initialFilters);

    const handleFilterChange = (next: SearchFilters) => {
      setFilters(next);
      onFilterChange(next);
    };

    const handleClearFilters = () => {
      setFilters({});
      onClearFilters();
    };

    return (
      <FilterSidebar
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        isOpen={isOpen}
        onClose={onClose}
      />
    );
  };

  return render(<Wrapper />);
}

describe('FilterSidebar', () => {
  it('toggles filter categories and emits updated values', () => {
    const handleChange = jest.fn();
    renderSidebar({ onFilterChange: handleChange });

    const blogCheckbox = screen.getByLabelText(/blog/i);
    fireEvent.click(blogCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.objectContaining({
      contentTypes: [ContentType.BLOG],
    }));

    fireEvent.click(blogCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.not.objectContaining({ contentTypes: expect.anything() }));

    const heroCheckbox = screen.getByLabelText(/hero/i);
    fireEvent.click(heroCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.objectContaining({
      badges: [BadgeType.HERO],
    }));

    fireEvent.click(heroCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.not.objectContaining({ badges: expect.anything() }));

    const awsOnlyCheckbox = screen.getByLabelText(/aws only/i);
    fireEvent.click(awsOnlyCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.objectContaining({
      visibility: [Visibility.AWS_ONLY],
    }));

    fireEvent.click(awsOnlyCheckbox);
    expect(handleChange).toHaveBeenLastCalledWith(expect.not.objectContaining({ visibility: expect.anything() }));
  });

  it('handles date range updates', () => {
    const handleChange = jest.fn();
    renderSidebar({ onFilterChange: handleChange });

    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: '2024-01-01' } });
    expect(handleChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dateRange: expect.objectContaining({
        start: expect.any(Date),
      }),
    }));
    expect(screen.getByDisplayValue('2024-01-01')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: '2024-02-01' } });
    expect(handleChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dateRange: expect.objectContaining({
        end: expect.any(Date),
      }),
    }));
    expect(screen.getByDisplayValue('2024-02-01')).toBeInTheDocument();

  });

  it('clears all filters and resets checkbox state', () => {
    const handleClear = jest.fn();
    renderSidebar({
      onClearFilters: handleClear,
      initialFilters: {
        contentTypes: [ContentType.BLOG],
        badges: [BadgeType.AMBASSADOR],
        visibility: [Visibility.PUBLIC],
        dateRange: { start: new Date('2024-01-01'), end: new Date('2024-02-01') },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(handleClear).toHaveBeenCalled();
    expect(screen.getByLabelText(/blog/i)).not.toBeChecked();
    expect(screen.getByLabelText(/ambassador/i)).not.toBeChecked();
    expect(screen.getByLabelText(/public/i)).not.toBeChecked();
    expect(screen.getByLabelText(/from date/i)).toHaveValue('');
    expect(screen.getByLabelText(/to date/i)).toHaveValue('');
  });

  it('invokes onClose callback when provided', () => {
    const handleClose = jest.fn();
    renderSidebar({ onClose: handleClose, isOpen: true });

    fireEvent.click(screen.getByLabelText(/close filters/i));
    expect(handleClose).toHaveBeenCalled();
  });
});
