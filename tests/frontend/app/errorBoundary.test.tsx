import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalError from '@/app/error';

describe('Global error boundary page', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.resetModules();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders the fallback UI and triggers reset on retry', () => {
    const reset = jest.fn();
    const error = Object.assign(new Error('Unexpected failure'), { digest: 'digest-id' });

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/digest-id/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('link', { name: /Return to homepage/i })).toHaveAttribute('href', '/');
  });
});
