import React from 'react';
import { render, screen } from '@testing-library/react';
import PrivacyPolicyPage from '@/app/privacy/page';

describe('PrivacyPolicyPage', () => {
  it('renders primary sections', () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/data retention/i)).toBeInTheDocument();
    expect(screen.getByText(/contact/i)).toBeInTheDocument();
  });
});
