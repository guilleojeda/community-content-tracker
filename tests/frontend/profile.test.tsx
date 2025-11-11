import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileContentSection from '@/app/profile/[username]/ProfileContentSection';
import { ContentType, Visibility, type Content } from '@shared/types';

const baseContent: Content[] = [
  {
    id: 'content-1',
    userId: 'user-1',
    title: 'Serverless Guide',
    description: 'Deep dive into serverless tooling',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2024-01-10'),
    captureDate: new Date('2024-01-11'),
    metrics: {},
    tags: ['serverless', 'lambda'],
    isClaimed: true,
    urls: [{ id: 'url-1', url: 'https://example.com/blog' }],
    createdAt: new Date('2024-01-11'),
    updatedAt: new Date('2024-01-11'),
  },
  {
    id: 'content-2',
    userId: 'user-1',
    title: 'Graph Modeling Talk',
    description: 'Graph databases overview',
    contentType: ContentType.CONFERENCE_TALK,
    visibility: Visibility.PUBLIC,
    captureDate: new Date('2024-02-01'),
    metrics: {},
    tags: ['graph', 'databases'],
    isClaimed: true,
    urls: [{ id: 'url-2', url: 'https://example.com/talk' }],
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  },
];

const renderSection = (overrides: Partial<React.ComponentProps<typeof ProfileContentSection>> = {}) =>
  render(
    <ProfileContentSection
      username="testuser"
      content={baseContent}
      {...overrides}
    />
  );

describe('ProfileContentSection', () => {
  it('renders the list of public content and summary text', () => {
    renderSection();

    expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
    expect(screen.getByText('Graph Modeling Talk')).toBeInTheDocument();
    expect(
      screen.getByText(/Showing 2 of 2 public items/i)
    ).toBeInTheDocument();
  });

  it('filters by content type', () => {
    renderSection();

    fireEvent.change(screen.getByLabelText(/content type/i), {
      target: { value: ContentType.BLOG },
    });

    expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
    expect(screen.queryByText('Graph Modeling Talk')).not.toBeInTheDocument();
  });

  it('filters by search term', () => {
    renderSection();

    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'graph' },
    });

    expect(screen.getByText('Graph Modeling Talk')).toBeInTheDocument();
    expect(screen.queryByText('Serverless Guide')).not.toBeInTheDocument();
  });

  it('filters by tags and supports clearing filters', () => {
    renderSection();

    fireEvent.change(screen.getByLabelText(/tags/i), {
      target: { value: 'lambda' },
    });

    expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
    expect(screen.queryByText('Graph Modeling Talk')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('clear-profile-filters'));

    expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
    expect(screen.getByText('Graph Modeling Talk')).toBeInTheDocument();
  });

  it('renders empty state when profile has no public content', () => {
    renderSection({ content: [] });

    expect(screen.getByText(/no public content available/i)).toBeInTheDocument();
    expect(
      screen.getByText(/testuser hasn't shared any public content yet./i)
    ).toBeInTheDocument();
  });

  it('shows no match state when filters exclude everything', () => {
    renderSection();

    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'nonexistent' },
    });

    expect(
      screen.getByText(/no content matches your filters/i)
    ).toBeInTheDocument();
  });
});
