'use client';

import React, { useMemo, useState } from 'react';
import type { Content } from '@shared/types';

interface ProfileContentSectionProps {
  content: Content[];
  username: string;
}

type ContentTypeValue = Content['contentType'];
type ContentTypeFilter = 'all' | ContentTypeValue;

export default function ProfileContentSection({
  content,
  username,
}: ProfileContentSectionProps) {
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentTypeFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const tagValues = useMemo(
    () =>
      tagFilter
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    [tagFilter]
  );

  const filteredContent = useMemo(() => {
    return content.filter((item) => {
      const matchesType = contentTypeFilter === 'all' || item.contentType === contentTypeFilter;

      const matchesSearch =
        normalizedSearch.length === 0 ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        (item.description ?? '').toLowerCase().includes(normalizedSearch) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch));

      const matchesTags =
        tagValues.length === 0 ||
        tagValues.every((tag) => item.tags.map((value) => value.toLowerCase()).includes(tag));

      return matchesType && matchesSearch && matchesTags;
    });
  }, [content, contentTypeFilter, normalizedSearch, tagValues]);

  const hasContent = content.length > 0;
  const hasActiveFilters = contentTypeFilter !== 'all' || normalizedSearch.length > 0 || tagValues.length > 0;

  const availableTypes = useMemo<ContentTypeValue[]>(() => {
    const unique = new Set<ContentTypeValue>();
    content.forEach((item) => unique.add(item.contentType));
    return Array.from(unique.values()).sort();
  }, [content]);

  return (
    <div className="bg-white rounded-lg shadow-md p-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Public Content</h2>

      {hasContent && (
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="content-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                Content Type
              </label>
              <select
                id="content-type-filter"
                value={contentTypeFilter}
                onChange={(event) => setContentTypeFilter(event.target.value as ContentTypeFilter)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="all">All Types</option>
                {availableTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
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
      )}

      {!hasContent ? (
        <div className="text-center py-12">
          <p className="text-xl text-gray-600">No public content available</p>
          <p className="text-gray-500 mt-2">{username} hasn&apos;t shared any public content yet.</p>
        </div>
      ) : filteredContent.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-xl text-gray-600">No content matches your filters</p>
          <p className="text-gray-500 mt-2">Try adjusting the content type, search terms, or tags.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredContent.map((item) => (
            <div key={item.id} className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow">
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
                  {item.description && <p className="text-gray-600 mb-3">{item.description}</p>}

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

                  {item.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.tags.map((tag) => (
                        <span key={`${item.id}-${tag}`} className="text-xs bg-aws-orange text-white px-2 py-1 rounded">
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

      {hasContent && (
        <div className="mt-6 text-sm text-gray-500 text-center">
          Showing {filteredContent.length} of {content.length} public{' '}
          {filteredContent.length === 1 ? 'item' : 'items'}
        </div>
      )}
    </div>
  );
}
