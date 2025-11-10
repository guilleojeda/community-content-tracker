import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePage from '@/app/profile/[username]/ProfileClient';
import { BadgeType, ContentType, Visibility, User, Badge, Content } from '@shared/types';

type MockClient = {
  getUserByUsername: jest.Mock<Promise<User>, [string]>;
  getUserBadgesByUserId: jest.Mock<Promise<Badge[]>, [string]>;
  getUserContent: jest.Mock<Promise<{ content: Content[]; total: number }>, [string, any?]>;
};

const mockClient: MockClient = {
  getUserByUsername: jest.fn(),
  getUserBadgesByUserId: jest.fn(),
  getUserContent: jest.fn(),
};

jest.mock('@/api/client', () => ({
  getPublicApiClient: jest.fn(() => mockClient),
}));

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const baseUser: User = {
  id: 'user-1',
  cognitoSub: 'cognito-1',
  email: 'test@example.com',
  username: 'testuser',
  profileSlug: 'testuser',
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
    awardedAt: new Date('2024-02-01'),
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  },
];

const contentItems: Content[] = [
  {
    id: 'content-1',
    userId: 'user-1',
    title: 'Serverless Guide',
    description: 'Deep dive into serverless',
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
    title: 'Graph Modeling',
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

const renderProfile = async (props: Partial<React.ComponentProps<typeof ProfilePage>> = {}) => {
  mockClient.getUserBadgesByUserId.mockResolvedValue(badges);
  mockClient.getUserContent.mockResolvedValue({ content: contentItems, total: contentItems.length });

  render(
    <ProfilePage
      params={{ username: 'testuser' }}
      initialUser={baseUser}
      {...props}
    />
  );

  await waitFor(() => {
    expect(mockClient.getUserBadgesByUserId).toHaveBeenCalledWith('user-1');
  });

  await waitFor(() => {
    expect(screen.queryByText(/loading profile/i)).not.toBeInTheDocument();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProfilePage', () => {
  it('displays user profile, badges, and content', async () => {
    await renderProfile();

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText(/aws hero/i)).toBeInTheDocument();
    expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
    expect(screen.getByText('Graph Modeling')).toBeInTheDocument();
  });

  it('filters content by type', async () => {
    await renderProfile();

    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: ContentType.BLOG } });

    await waitFor(() => {
      expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
      expect(screen.queryByText('Graph Modeling')).not.toBeInTheDocument();
    });
  });

  it('filters content by search term', async () => {
    await renderProfile();

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'graph' } });

    await waitFor(() => {
      expect(screen.getByText('Graph Modeling')).toBeInTheDocument();
      expect(screen.queryByText('Serverless Guide')).not.toBeInTheDocument();
    });
  });

  it('filters content by tags', async () => {
    await renderProfile();

    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: 'lambda' } });

    await waitFor(() => {
      expect(screen.getByText('Serverless Guide')).toBeInTheDocument();
      expect(screen.queryByText('Graph Modeling')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when user has no content', async () => {
    mockClient.getUserBadgesByUserId.mockResolvedValue([]);
    mockClient.getUserContent.mockResolvedValue({ content: [], total: 0 });

    render(
      <ProfilePage
        params={{ username: 'testuser' }}
        initialUser={baseUser}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no public content available/i)).toBeInTheDocument();
    });
  });

  it('surfaces fetch errors when badges or content calls fail', async () => {
    mockClient.getUserBadgesByUserId.mockRejectedValue(new Error('boom'));

    render(
      <ProfilePage
        params={{ username: 'testuser' }}
        initialUser={baseUser}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument();
    });
  });

  it('shows AWS employee badge when the profile belongs to an employee', async () => {
    await renderProfile();

    expect(screen.getByText(/aws employee/i)).toBeInTheDocument();
  });

  it('hides AWS employee badge for community members', async () => {
    render(
      <ProfilePage
        params={{ username: 'testuser' }}
        initialUser={{ ...baseUser, isAwsEmployee: false }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
    expect(screen.queryByText(/aws employee/i)).not.toBeInTheDocument();
  });

  it('renders social links and contact CTA when provided', async () => {
    const socialLinks = {
      twitter: 'https://twitter.com/testuser',
      linkedin: 'https://linkedin.com/in/testuser',
      github: 'https://github.com/testuser',
      website: 'https://testuser.dev',
    };

    await renderProfile({
      initialUser: { ...baseUser, socialLinks },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/twitter/i)).toHaveAttribute('href', socialLinks.twitter);
    });

    expect(screen.getByLabelText(/linkedin/i)).toHaveAttribute('href', socialLinks.linkedin);
    expect(screen.getByLabelText(/github/i)).toHaveAttribute('href', socialLinks.github);
    expect(screen.getByLabelText(/website/i)).toHaveAttribute('href', socialLinks.website);

    const contactButton = screen.getByRole('link', { name: /contact testuser/i });
    expect(contactButton).toHaveAttribute(
      'href',
      `mailto:${baseUser.email}?subject=AWS Community - Contact from ${baseUser.username}'s profile`
    );
  });
});
