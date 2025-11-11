import React from 'react';
import { render, screen } from '@testing-library/react';
import FeedbackPage from '@/app/feedback/page';

jest.mock('@/lib/featureFlags', () => ({
  isBetaModeActive: jest.fn(),
  feedbackUrl: 'https://feedback.example.com/form',
}));

const { isBetaModeActive } = jest.requireMock('@/lib/featureFlags') as {
  isBetaModeActive: jest.Mock;
};

describe('FeedbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a lock message when beta mode is disabled', () => {
    isBetaModeActive.mockReturnValue(false);

    render(<FeedbackPage />);

    expect(screen.getByText(/feedback unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/beta feedback form/i)).not.toBeInTheDocument();
  });

  it('renders embedded feedback form when beta mode is active', () => {
    isBetaModeActive.mockReturnValue(true);

    render(<FeedbackPage />);

    const iframe = screen.getByTitle(/beta feedback form/i);
    expect(iframe).toHaveAttribute('src', 'https://feedback.example.com/form');
  });
});
