'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, BadgeType, Content, ContentType, User, Visibility } from '@shared/types';
import { getBadgeLabel, getBadgeColor } from '@/lib/constants/ui';
import { getPublicApiClient } from '@/api/client';

interface ProfileClientProps {
  params: {
    username: string;
  };
  initialUser?: User | null;
}

export default function ProfilePage({ params, initialUser }: ProfileClientProps) {
  const router = useRouter();
  const username = params.username;

  const [user, setUser] = useState<User | null>(initialUser ?? null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentTypeFilter, setContentTypeFilter] = useState<'all' | ContentType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => {
    if (initialUser) {
      setUser(initialUser);
    }
  }, [initialUser]);

  useEffect(() => {
    if (!username) {
      setLoading(false);
      setError('No username provided');
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const client = getPublicApiClient();
        let resolvedUser = initialUser ?? null;

        if (!resolvedUser) {
          resolvedUser = await client.getUserByUsername(username);
          if (!isMounted) {
            return;
          }
          setUser(resolvedUser);
        }

        const [badgesData, contentData] = await Promise.all([
          client.getUserBadgesByUserId(resolvedUser.id),
          client.getUserContent(resolvedUser.id, { visibility: Visibility.PUBLIC }),
        ]);

        if (!isMounted) {
          return;
        }

        setBadges(badgesData);
        setContent(contentData.content);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        console.error('Error fetching profile data:', err);
        setError('Failed to load profile');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [username, initialUser?.id]);

  const filteredContent = useMemo(() => {
    const searchValue = searchTerm.trim().toLowerCase();
    const tagValues = tagFilter
      .split(',')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean);

    return content.filter(item => {
      const matchesType =
        contentTypeFilter === 'all' || item.contentType === contentTypeFilter;

      const matchesSearch =
        searchValue.length === 0 ||
        item.title.toLowerCase().includes(searchValue) ||
        (item.description || '').toLowerCase().includes(searchValue) ||
        item.tags.some(tag => tag.toLowerCase().includes(searchValue));

      const matchesTags =
        tagValues.length === 0 ||
        tagValues.every(tag =>
          item.tags.map(t => t.toLowerCase()).includes(tag)
        );

      return matchesType && matchesSearch && matchesTags;
    });
  }, [content, contentTypeFilter, searchTerm, tagFilter]);

  const hasContent = content.length > 0;
  const hasActiveFilters =
    contentTypeFilter !== 'all' ||
    searchTerm.trim().length > 0 ||
    tagFilter
      .split(',')
      .some(tag => tag.trim().length > 0);

  // Loading state
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-aws-blue mx-auto mb-4"></div>
            <p className="text-gray-600">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Profile Not Found</h1>
            <p className="text-xl text-gray-600 mb-8">
              {error || 'The requested user profile could not be found.'}
            </p>
            <button
              onClick={() => router.push('/dashboard/search')}
              className="btn-primary"
            >
              Back to Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Profile Header */}
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-aws-blue mb-2">{user.username}</h1>
            <p className="text-gray-600">{user.email}</p>
            {user.bio && (
              <p className="text-gray-600 mt-2">{user.bio}</p>
            )}
          </div>
        </div>

        {/* AWS Employee Badge */}
        {user.isAwsEmployee && (
          <div className="mt-4">
            <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-aws-orange text-white">
              <svg
                className="w-4 h-4 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              AWS Employee
            </span>
          </div>
        )}

        {/* Badges Section */}
        {badges.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-3">AWS Program Badges</h2>
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span
                  key={badge.id}
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold text-white ${getBadgeColor(
                    badge.badgeType
                  )}`}
                >
                  {getBadgeLabel(badge.badgeType)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Social Links */}
        {user.socialLinks && Object.keys(user.socialLinks).length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Social Links</h3>
            <div className="flex gap-3">
              {user.socialLinks.twitter && (
                <a
                  href={user.socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 transition-colors"
                  aria-label="Twitter"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" />
                  </svg>
                </a>
              )}
              {user.socialLinks.linkedin && (
                <a
                  href={user.socialLinks.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:text-blue-900 transition-colors"
                  aria-label="LinkedIn"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </a>
              )}
              {user.socialLinks.github && (
                <a
                  href={user.socialLinks.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-800 hover:text-gray-600 transition-colors"
                  aria-label="GitHub"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                </a>
              )}
              {user.socialLinks.website && (
                <a
                  href={user.socialLinks.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-aws-orange hover:text-orange-700 transition-colors"
                  aria-label="Website"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Member Since */}
        <div className="mt-6 text-sm text-gray-500">
          Member since {new Date(user.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
          })}
        </div>

        {/* Contact Button */}
        <div className="mt-6">
          <a
            href={`mailto:${user.email}?subject=AWS Community - Contact from ${user.username}'s profile`}
            className="inline-flex items-center px-4 py-2 bg-aws-blue text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Contact {user.username}
          </a>
        </div>
      </div>

      {/* Public Content Section */}
      <div className="bg-white rounded-lg shadow-md p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Public Content</h2>

        {/* Filters */}
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="content-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                Content Type
              </label>
              <select
                id="content-type-filter"
                value={contentTypeFilter}
                onChange={(event) => setContentTypeFilter(event.target.value as 'all' | ContentType)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="all">All Types</option>
                {Object.values(ContentType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="content-search" className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <input
                id="content-search"
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title, description, or tags"
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="tag-filter" className="block text-sm font-medium text-gray-700 mb-1">
                Tags (comma separated)
              </label>
              <input
                id="tag-filter"
                type="text"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                placeholder="serverless, lambda"
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setContentTypeFilter('all');
                  setSearchTerm('');
                  setTagFilter('');
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
                data-testid="clear-profile-filters"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {!hasContent ? (
          <div className="text-center py-12">
            <p className="text-xl text-gray-600">No public content available</p>
            <p className="text-gray-500 mt-2">
              {user.username} hasn't shared any public content yet.
            </p>
          </div>
        ) : filteredContent.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xl text-gray-600">No content matches your filters</p>
            <p className="text-gray-500 mt-2">
              Try adjusting the content type, search terms, or tags.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredContent.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold mb-2 text-aws-blue">
                      {item.urls && item.urls.length > 0 ? (
                        <a
                          href={item.urls[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-aws-orange transition-colors"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span>{item.title}</span>
                      )}
                    </h3>
                    {item.description && (
                      <p className="text-gray-600 mb-3">{item.description}</p>
                    )}

                    {/* Content Type Badge */}
                    <div className="flex items-center gap-4 text-sm">
                      <span className="bg-gray-100 px-3 py-1 rounded-full text-gray-700 font-medium">
                        {item.contentType}
                      </span>
                      {item.publishDate && (
                        <span className="text-gray-500">
                          {new Date(item.publishDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    {item.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.tags.map((tag: string, idx: number) => (
                          <span
                            key={idx}
                            className="text-xs bg-aws-orange text-white px-2 py-1 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Content Count */}
        {filteredContent.length > 0 && (
          <div className="mt-6 text-sm text-gray-500 text-center">
            Showing {filteredContent.length} of {content.length}{' '}
            public {filteredContent.length === 1 ? 'item' : 'items'}
          </div>
        )}
      </div>

      {/* Back to Search Link */}
      <div className="mt-8 text-center">
        <button
          onClick={() => router.push('/dashboard/search')}
          className="text-aws-blue hover:text-aws-orange transition-colors font-medium"
        >
          ← Back to Search
        </button>
      </div>
    </div>
  );
}
