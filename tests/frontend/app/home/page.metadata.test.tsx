import React from 'react';
import { metadata } from '@/app/page';
import HomePageContent from '@/app/HomePageContent';
import { render, screen } from '@testing-library/react';

const mockGetStats = jest.fn().mockResolvedValue(null);
const mockPush = jest.fn();

jest.mock('@/api/client', () => ({
  getPublicApiClient: () => ({
    getStats: mockGetStats,
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

afterEach(() => {
  mockGetStats.mockClear();
  mockPush.mockClear();
});

jest.mock('next/image', () => (props: any) => <img {...props} />);

describe('Home page metadata', () => {
  it('defines SEO and social sharing fields', () => {
    expect(metadata.title).toContain('AWS Community Content Hub');
    expect(metadata.description).toContain('Search and track');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/og-image.svg');
    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.alternates?.canonical).toMatch(/^https?:\/\//);
  });
});

describe('Home page responsiveness', () => {
  it('renders responsive hero sections and imagery', () => {
    render(<HomePageContent />);

    const heroGrid = screen.getByText(/Discover AWS Community Content/i).closest('section');
    expect(heroGrid?.className).toContain('bg-gradient-to-r');

    const illustration = screen.getByAltText('Community illustration');
    expect(illustration).toBeInTheDocument();
    expect(illustration.parentElement?.className).toContain('hidden md:block');
  });
});
