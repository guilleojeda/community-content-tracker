import React from 'react';
import { render, screen } from '@testing-library/react';
import Loading from '@/app/loading';

describe('Global loading boundary', () => {
  it('renders spinner and helper text', () => {
    const { container } = render(<Loading />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
