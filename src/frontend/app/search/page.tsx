'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadPublicApiClient } from '@/lib/api/lazyClient';
import type { ApiClient } from '@/api/client';
import type { Content } from '@shared/types';

type SearchResponse = {
  items?: Content[];
  results?: Content[];
  total: number;
  limit?: number;
  offset?: number;
};

type ContentItem = Content;

type ApiSearchResponse = Awaited<ReturnType<ApiClient['search']>>;
type ApiSearchItem = ApiSearchResponse['items'][number];

const toDate = (value?: string | Date | null): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeMetrics = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
};

const normalizeUrls = (urls: ApiSearchItem['urls'] | undefined): Content['urls'] => {
  if (!urls) return [];
  return urls
    .filter((url): url is { id?: string; url?: string } => Boolean(url && url.url))
    .map((url) => ({
      id: url.id ?? url.url!,
      url: url.url!,
    }));
};

const normalizeContentItem = (item: ApiSearchItem): Content => {
  const fallbackDate =
    toDate(item.captureDate) ?? toDate(item.createdAt) ?? toDate(item.updatedAt) ?? new Date();
  const createdAt = toDate(item.createdAt) ?? fallbackDate;
  const captureDate = toDate(item.captureDate) ?? createdAt;
  const updatedAt = toDate(item.updatedAt) ?? createdAt;

  return {
    id: item.id,
    userId: item.userId ?? item.id,
    title: item.title,
    description: item.description ?? undefined,
    contentType: item.contentType as Content['contentType'],
    visibility: item.visibility as Content['visibility'],
    publishDate: toDate(item.publishDate),
    captureDate,
    metrics: normalizeMetrics(item.metrics),
    tags: Array.isArray(item.tags) ? item.tags : [],
    embedding: Array.isArray((item as { embedding?: unknown }).embedding)
      ? ((item as { embedding?: number[] }).embedding as number[])
      : undefined,
    isClaimed: Boolean(item.isClaimed),
    originalAuthor: item.originalAuthor ?? undefined,
    urls: normalizeUrls(item.urls),
    createdAt,
    updatedAt,
    deletedAt: toDate((item as { deletedAt?: string | Date | null }).deletedAt),
    version: typeof (item as { version?: number }).version === 'number' ? (item as { version?: number }).version! : 1,
  };
};

function SearchContent() {
  const searchParams = useSearchParams();
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterTags, setFilterTags] = useState<string>('');
  const [filterBadges, setFilterBadges] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const resultsPerPage = 10;

  useEffect(() => {
    // Check authentication status
    setIsAuthenticated(
      !!localStorage.getItem('accessToken') || !!sessionStorage.getItem('accessToken')
    );
  }, []);

  useEffect(() => {
    if (!searchParams) return;

    const query = searchParams.get('q');
    const page = searchParams.get('page');
    const type = searchParams.get('type');
    const tags = searchParams.get('tags');
    const badges = searchParams.get('badges');

    if (query) {
      setSearchQuery(query);
      setCurrentPage(page ? parseInt(page, 10) : 1);
      if (type) setFilterType(type);
      if (tags) setFilterTags(tags);
      if (badges) setFilterBadges(badges);

      performSearch(query, {
        type: type || undefined,
        tags: tags || undefined,
        badges: badges || undefined,
        page: page ? parseInt(page, 10) : 1
      });
    }
  }, [searchParams]);

  const performSearch = async (query: string, options?: {
    type?: string;
    tags?: string;
    badges?: string;
    page?: number;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const page = options?.page || 1;
      const offset = (page - 1) * resultsPerPage;

      const params: Record<string, any> = {
        q: query,
        limit: resultsPerPage,
        offset,
      };

      if (options?.type) params.type = options.type;
      if (options?.tags) params.tags = options.tags;
      if (options?.badges) params.badges = options.badges;

      const client = await loadPublicApiClient();
      const data: ApiSearchResponse = await client.search(params as any);

      // Normalize response to handle both 'items' and 'results' array formats
      const raw = data as unknown as {
        items?: ApiSearchItem[];
        results?: ApiSearchItem[];
        total?: number;
        limit?: number;
        offset?: number;
      };
      const rawItems = Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(raw.results)
          ? raw.results
          : [];
      const mappedItems = rawItems.map((item) => normalizeContentItem(item));
      const normalizedData: SearchResponse = {
        total: typeof raw.total === 'number' ? raw.total : mappedItems.length,
        limit: typeof raw.limit === 'number' ? raw.limit : resultsPerPage,
        offset: typeof raw.offset === 'number' ? raw.offset : offset,
        items: mappedItems,
      };

      const publicOnly = (normalizedData.items ?? []).filter(
        (item: ContentItem) => item.visibility === 'public'
      );

      const sanitizedData: SearchResponse = {
        ...normalizedData,
        items: publicOnly,
      };

      setResults(sanitizedData);

      // Update URL with current search parameters
      const urlParams = new URLSearchParams({ q: query });
      if (options?.type) urlParams.append('type', options.type);
      if (options?.tags) urlParams.append('tags', options.tags);
      if (options?.badges) urlParams.append('badges', options.badges);
      if (page > 1) urlParams.append('page', page.toString());
      window.history.replaceState({}, '', `?${urlParams.toString()}`);
    } catch (err) {
      setError('Failed to perform search. Please try again.');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setCurrentPage(1);
      performSearch(searchQuery, {
        type: filterType || undefined,
        tags: filterTags || undefined,
        badges: filterBadges || undefined,
        page: 1
      });
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    performSearch(searchQuery, {
      type: filterType || undefined,
      tags: filterTags || undefined,
      badges: filterBadges || undefined,
      page: newPage
    });
  };

  const totalPages = results ? Math.ceil(results.total / resultsPerPage) : 0;
  const startResult = results ? (currentPage - 1) * resultsPerPage + 1 : 0;
  const endResult = results ? Math.min(currentPage * resultsPerPage, results.total) : 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Search AWS content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field flex-1"
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm font-medium mb-1">Content Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-field"
            >
              <option value="">All Types</option>
              <option value="blog">Blog</option>
              <option value="youtube">YouTube</option>
              <option value="github">GitHub</option>
              <option value="conference_talk">Conference Talk</option>
              <option value="podcast">Podcast</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">AWS Program Badges</label>
            <select
              value={filterBadges}
              onChange={(e) => setFilterBadges(e.target.value)}
              className="input-field"
            >
              <option value="">All Contributors</option>
              <option value="hero">AWS Hero</option>
              <option value="community_builder">Community Builder</option>
              <option value="ambassador">AWS Ambassador</option>
              <option value="user_group_leader">User Group Leader</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <input
              type="text"
              placeholder="e.g., serverless,lambda"
              value={filterTags}
              onChange={(e) => setFilterTags(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-aws-orange border-t-transparent"></div>
          <p className="mt-4 text-gray-600">Searching...</p>
        </div>
      )}

      {results && !loading && (
        <div>
          <div className="mb-4 text-gray-600">
            {results.total > 0 ? (
              <>Showing {startResult}-{endResult} of {results.total} results</>
            ) : (
              <>Found 0 results</>
            )}
          </div>

          {!results?.items || results.items.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600">No results found</p>
              <p className="text-gray-500 mt-2">Try different search terms or filters</p>
            </div>
          ) : (
            <>
              <div className="space-y-6">
                {results.items.map((item) => (
                  <div key={item.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                    <h3 className="text-xl font-bold mb-2 text-aws-blue">
                      <a href={item.urls[0]?.url} target="_blank" rel="noopener noreferrer" className="hover:text-aws-orange">
                        {item.title}
                      </a>
                    </h3>
                    {item.description && (
                      <p className="text-gray-600 mb-3">{item.description}</p>
                    )}
                    <div className="flex gap-4 text-sm text-gray-500">
                      <span className="bg-gray-100 px-2 py-1 rounded">
                        {item.contentType}
                      </span>
                      {item.publishDate && (
                        <span>
                          {new Date(item.publishDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {item.tags.length > 0 && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {item.tags.map((tag, idx) => (
                          <span key={idx} className="text-xs bg-aws-orange text-white px-2 py-1 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex justify-center items-center gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                  >
                    Previous
                  </button>

                  {/* Page numbers */}
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let pageNumber: number;

                      if (totalPages <= 7) {
                        // Show all pages if total is 7 or less
                        pageNumber = i + 1;
                      } else if (currentPage <= 4) {
                        // Show first 5 pages, then ellipsis, then last page
                        if (i < 5) pageNumber = i + 1;
                        else if (i === 5) return <span key="ellipsis" className="px-2 py-2">...</span>;
                        else pageNumber = totalPages;
                      } else if (currentPage >= totalPages - 3) {
                        // Show first page, ellipsis, then last 5 pages
                        if (i === 0) pageNumber = 1;
                        else if (i === 1) return <span key="ellipsis" className="px-2 py-2">...</span>;
                        else pageNumber = totalPages - (6 - i);
                      } else {
                        // Show first page, ellipsis, current-1, current, current+1, ellipsis, last page
                        if (i === 0) pageNumber = 1;
                        else if (i === 1) return <span key="ellipsis1" className="px-2 py-2">...</span>;
                        else if (i === 2) pageNumber = currentPage - 1;
                        else if (i === 3) pageNumber = currentPage;
                        else if (i === 4) pageNumber = currentPage + 1;
                        else if (i === 5) return <span key="ellipsis2" className="px-2 py-2">...</span>;
                        else pageNumber = totalPages;
                      }

                      return (
                        <button
                          key={pageNumber}
                          onClick={() => handlePageChange(pageNumber)}
                          className={`px-4 py-2 border rounded-lg transition-colors ${
                            currentPage === pageNumber
                              ? 'bg-aws-orange text-white border-aws-orange'
                              : 'hover:bg-gray-100'
                          }`}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Call to Action for Anonymous Users */}
      {!loading && results && !isAuthenticated && (
        <div className="mt-12 bg-aws-blue text-white p-8 rounded-lg text-center">
          <h3 className="text-2xl font-bold mb-4">Want to see more content?</h3>
          <p className="mb-6">Register for free to access content from the AWS community</p>
          <a href="/auth/register" className="btn-primary inline-block">
            Create Account
          </a>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
}
