'use client';

import React from 'react';
import Link from 'next/link';
import { User, Badge } from '@shared/types';
import { getBadgeLabel, getBadgeBadgeClass } from '@/lib/constants/ui';
import type { components as ApiComponents } from '@/api';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

type SearchResultItem =
  ApiComponents['schemas']['SearchResponse']['items'][number] & {
    user?: User;
    badges?: Badge[];
  };

interface SearchResultsData {
  items: SearchResultItem[];
  total: number;
}

const getMetricValue = (
  metrics: Record<string, unknown> | undefined,
  key: string
): number | undefined => {
  const value = metrics?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

interface SearchResultsProps {
  results: SearchResultsData | null;
  loading: boolean;
  currentPage: number;
  totalPages: number;
  resultsPerPage: number;
  onPageChange: (page: number) => void;
}

export default function SearchResults({
  results,
  loading,
  currentPage,
  totalPages,
  resultsPerPage,
  onPageChange,
}: SearchResultsProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Searching...</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-lg text-gray-600 font-medium">Enter a search query to find content</p>
        <p className="text-sm text-gray-500 mt-2">Search for AWS community content, creators, and topics</p>
      </div>
    );
  }

  if (results.items?.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-lg text-gray-600 font-medium">No results found</p>
        <p className="text-sm text-gray-500 mt-2">Try adjusting your search query or filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results Count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Showing <span className="font-semibold">{((currentPage - 1) * resultsPerPage) + 1}-{Math.min(currentPage * resultsPerPage, results.total)}</span> of <span className="font-semibold">{results.total}</span> results
        </div>
      </div>

      {/* Results List */}
      <div className="space-y-4">
        {results.items?.map((item) => {
          const metrics = item.metrics as Record<string, unknown> | undefined;
          const views = getMetricValue(metrics, 'views');
          const likes = getMetricValue(metrics, 'likes');

          return (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow border border-gray-200"
            >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Title and Link */}
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {item.urls && item.urls.length > 0 ? (
                    <a
                      href={item.urls[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-600 transition-colors"
                      onClick={async () => {
                        try {
                          const client = await loadSharedApiClient();
                          await client.trackAnalyticsEvents({
                            eventType: 'content_click',
                            contentId: item.id,
                            metadata: {
                              source: 'search_results',
                              url: item.urls?.[0]?.url,
                            },
                          });
                        } catch (err) {
                          // ignore analytics errors
                        }
                      }}
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span>{item.title}</span>
                  )}
                </h3>

                {/* Description */}
                {item.description && (
                  <p className="text-gray-600 mb-3 line-clamp-2">{item.description}</p>
                )}

                {/* Badges and Metadata */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {/* Content Type Badge */}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {item.contentType}
                  </span>

                  {/* Visibility Badge */}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {item.visibility}
                  </span>

                  {/* Tags */}
                  {item.tags?.slice(0, 3).map((tag: string) => (
                    <span key={tag} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {tag}
                    </span>
                  ))}
                  {item.tags && item.tags.length > 3 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      +{item.tags.length - 3} more
                    </span>
                  )}
                </div>

                {/* Author and Badges */}
                {item.user && (
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">By</span>
                      <Link
                        href={`/profile/${item.user.username}`}
                        className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                      >
                        {item.user.username}
                      </Link>
                      {item.user.isAwsEmployee && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          AWS Employee
                        </span>
                      )}
                    </div>

                    {/* User Badges */}
                    {item.badges && item.badges.length > 0 && (
                      <div className="flex items-center gap-1">
                        {item.badges.slice(0, 2).map((badge) => (
                          <span
                            key={badge.id}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getBadgeBadgeClass(badge.badgeType)}`}
                          >
                            {getBadgeLabel(badge.badgeType)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Metrics */}
                {(views !== undefined || likes !== undefined || item.publishDate) && (
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                    {views !== undefined && (
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        <span>{views.toLocaleString()} views</span>
                      </div>
                    )}
                    {likes !== undefined && (
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        <span>{likes.toLocaleString()} likes</span>
                      </div>
                    )}
                    {item.publishDate && (
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>{new Date(item.publishDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8 pb-4">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    currentPage === pageNum
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 hover:bg-gray-50'
                  }`}
                  aria-label={`Page ${pageNum}`}
                  aria-current={currentPage === pageNum ? 'page' : undefined}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
