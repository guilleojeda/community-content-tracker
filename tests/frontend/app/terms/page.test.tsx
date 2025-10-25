import React from 'react';
import { render, screen } from '@testing-library/react';
import TermsPage from '@/app/terms/page';

describe('TermsPage', () => {
  it('renders key terms sections', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { name: /terms of service/i })).toBeInTheDocument();
    expect(screen.getByText(/user obligations/i)).toBeInTheDocument();
    expect(screen.getByText(/limitation of liability/i)).toBeInTheDocument();
  });
});
