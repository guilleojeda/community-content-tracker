import React from 'react';
import { render, screen } from '@testing-library/react';
import ProfileClient from '@/app/profile/[username]/ProfileClient';
import { BadgeType, ContentType, Visibility, type Badge, type Content, type User } from '@shared/types';

let capturedSectionProps: any = null;

jest.mock('next/dynamic', () => {
  const React = require('react');
  return () => (props: any) => {
    capturedSectionProps = props;
    return React.createElement('div', { 'data-testid': 'profile-content-section' });
  };
});

const user: User = {
  id: 'user-1',
  cognitoSub: 'cognito-1',
  email: 'test@example.com',
  username: 'testuser',
  profileSlug: 'testuser',
  bio: 'AWS Community Builder',
  socialLinks: {
    twitter: 'https://twitter.com/testuser',
    linkedin: 'https://linkedin.com/in/testuser',
    github: 'https://github.com/testuser',
    website: 'https://testuser.dev',
  },
  defaultVisibility: Visibility.PUBLIC,
  isAdmin: false,
  isAwsEmployee: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
};

const badges: Badge[] = [
  {
    id: 'badge-1',
    userId: 'user-1',
    badgeType: BadgeType.HERO,
    awardedAt: new Date('2023-06-01'),
    createdAt: new Date('2023-06-01'),
    updatedAt: new Date('2023-06-01'),
  },
];

const content: Content[] = [
  {
    id: 'content-1',
    userId: 'user-1',
    title: 'Serverless Patterns',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    captureDate: new Date('2024-02-01'),
    metrics: {},
    tags: ['serverless'],
    urls: [{ id: 'url-1', url: 'https://example.com/blog' }],
    isClaimed: true,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  },
];

describe('ProfileClient', () => {
  beforeEach(() => {
    capturedSectionProps = null;
  });

  it('renders profile details, badges, and AWS employee badge', () => {
    render(<ProfileClient user={user} badges={badges} content={content} />);

    expect(screen.getByRole('heading', { name: user.username })).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.getByText(/aws employee/i)).toBeInTheDocument();
    expect(screen.getByText(/aws hero/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contact testuser/i })).toHaveAttribute(
      'href',
      `mailto:${user.email}?subject=AWS Community - Contact from ${user.username}'s profile`
    );
  });

  it('exposes social links with accessible labels', () => {
    render(<ProfileClient user={user} badges={badges} content={content} />);

    expect(screen.getByLabelText(/twitter/i)).toHaveAttribute('href', user.socialLinks?.twitter);
    expect(screen.getByLabelText(/linkedin/i)).toHaveAttribute('href', user.socialLinks?.linkedin);
    expect(screen.getByLabelText(/github/i)).toHaveAttribute('href', user.socialLinks?.github);
    expect(screen.getByLabelText(/website/i)).toHaveAttribute('href', user.socialLinks?.website);
  });

  it('passes content props to the lazy-loaded section', () => {
    render(<ProfileClient user={user} badges={badges} content={content} />);

    expect(screen.getByTestId('profile-content-section')).toBeInTheDocument();
    expect(capturedSectionProps).toMatchObject({
      content,
      username: user.username,
    });
  });
});
