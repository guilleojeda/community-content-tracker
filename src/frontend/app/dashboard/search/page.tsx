'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { downloadBlob } from '@/utils/download';
import { BadgeType, ContentType, Visibility, SearchFilters } from '@shared/types';
import SearchBar from './SearchBar';
import { useSearchHistory } from './hooks/useSearchHistory';
import { useSavedSearches } from './hooks/useSavedSearches';
import type { components as ApiComponents } from '@/api';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

interface SearchParams {
  q: string;
  filters?: SearchFilters;
  sortBy?: 'relevance' | 'date';
  limit?: number;
  offset?: number;
}

type ApiSearchResponse = ApiComponents['schemas']['SearchResponse'];

const FilterSidebar = dynamic(() => import('./FilterSidebar'), {
  loading: () => (
    <div className="hidden lg:block lg:w-80">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Loading filters…</p>
      </div>
    </div>
  ),
});

const SearchResults = dynamic(() => import('./SearchResults'), {
  loading: () => (
    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      <p className="mt-4 text-gray-600">Loading results…</p>
    </div>
  ),
});

export default function AuthenticatedSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [sortBy, setSortBy] = useState<'relevance' | 'date'>('relevance');
  const [results, setResults] = useState<ApiSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const resultsPerPage = 10;
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [searchWithinResults, setSearchWithinResults] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Custom hooks for history and saved searches
  const { addToHistory, getHistory, clearHistory } = useSearchHistory();
  const { saveSearch, getSavedSearches, loadSearch, deleteSavedSearch } = useSavedSearches();

  // Parse filters from URL parameters
  const parseFiltersFromUrl = useCallback((params: URLSearchParams): SearchFilters => {
    const parsed: SearchFilters = {};

    // Content types
    const types = params.get('type');
    if (types) {
      parsed.contentTypes = types.split(',').filter(Boolean) as ContentType[];
    }

    // Badges
    const badges = params.get('badges');
    if (badges) {
      parsed.badges = badges.split(',').filter(Boolean) as BadgeType[];
    }

    // Visibility
    const visibility = params.get('visibility');
    if (visibility) {
      parsed.visibility = visibility.split(',').filter(Boolean) as Visibility[];
    }

    // Tags
    const tags = params.get('tags');
    if (tags) {
      parsed.tags = tags.split(',').filter(Boolean);
    }

    // Date range
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    if (startDate && endDate) {
      parsed.dateRange = {
        start: new Date(startDate),
        end: new Date(endDate)
      };
    }

    return parsed;
  }, []);

  // Load initial search from URL params
  useEffect(() => {
    if (!searchParams) return;

    const q = searchParams.get('q');
    const urlFilters = parseFiltersFromUrl(searchParams);
    const urlSort = searchParams.get('sortBy') as 'relevance' | 'date' | null;
    const page = searchParams.get('page');
    const mode = searchParams.get('mode');

    // Set state from URL
    if (q) setQuery(q);
    if (Object.keys(urlFilters).length > 0) setFilters(urlFilters);
    if (urlSort) setSortBy(urlSort);
    if (page) setCurrentPage(parseInt(page, 10));
    if (mode === 'advanced') setUseAdvanced(true);

    // Perform search if query exists
    if (q) {
      const offset = page ? (parseInt(page, 10) - 1) * resultsPerPage : 0;
      performSearch({ q, filters: urlFilters, sortBy: urlSort || 'relevance', offset });
    }
  }, []);

  const performSearch = useCallback(async (params: SearchParams) => {
    setLoading(true);
    setError(null);
    setSearchMessage(null);

    try {
      const { q, filters: searchFilters, sortBy: sort } = params;
      const offset = params.offset ?? 0;
      let normalized: ApiSearchResponse;
      const client = await loadSharedApiClient();

      if (useAdvanced || searchWithinResults) {
        const withinIds =
          searchWithinResults && results ? results.items.map(item => item.id) : undefined;

        const advanced = await client.advancedSearch({
          query: q,
          withinIds,
          limit: resultsPerPage,
        });

        const mappedItems: ApiSearchResponse['items'] = advanced.results.map(result => {
          const metrics: Record<string, unknown> =
            (result.metrics as Record<string, unknown> | undefined) ?? {};

          return {
            id: result.id,
            userId: result.userId,
            title: result.title,
            description: result.description ?? '',
            contentType: result.contentType ?? ContentType.BLOG,
            visibility: result.visibility ?? Visibility.PUBLIC,
            publishDate: result.publishDate ?? undefined,
            captureDate: result.captureDate ?? undefined,
            metrics,
            tags: Array.isArray(result.tags) ? result.tags : [],
            isClaimed: result.isClaimed ?? true,
            originalAuthor: result.originalAuthor ?? undefined,
            urls: result.url
              ? [{ id: `${result.id}-primary-url`, url: result.url }]
              : [],
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies ApiSearchResponse['items'][number];
        });

        normalized = {
          items: mappedItems,
          total: advanced.count ?? mappedItems.length,
          limit: resultsPerPage,
          offset,
        };
      } else {
        const apiParams: {
          q: string;
          limit: number;
          offset: number;
          filters?: SearchFilters;
          sortBy?: string;
        } = {
          q,
          limit: resultsPerPage,
          offset,
        };

        if (searchFilters) {
          apiParams.filters = searchFilters;
        }

        if (sort && sort !== 'relevance') {
          apiParams.sortBy = sort;
        }

        const data = await client.search(apiParams);
        const raw = data as unknown as {
          items?: ApiSearchResponse['items'];
          results?: ApiSearchResponse['items'];
          content?: ApiSearchResponse['items'];
          total?: number;
          limit?: number;
          offset?: number;
        };

        const normalizedItems: ApiSearchResponse['items'] =
          raw.items ??
          raw.results ??
          raw.content ??
          ([] as ApiSearchResponse['items']);

        normalized = {
          items: normalizedItems,
          total: raw.total ?? normalizedItems.length,
          limit: raw.limit ?? resultsPerPage,
          offset: raw.offset ?? offset,
        };
      }

      setResults(normalized);

      // Add to search history
      addToHistory({ query: q, filters: searchFilters || {}, timestamp: Date.now() });

      client
        .trackAnalyticsEvents({
          eventType: 'search',
          metadata: {
            query: q,
            resultCount: normalized.total,
            advanced: useAdvanced || searchWithinResults,
            filters: searchFilters,
          },
        })
        .catch(() => {});

      // Update URL with all search parameters
      const urlParams = new URLSearchParams({ q });

      // Add filters to URL
      if (searchFilters) {
        if (searchFilters.contentTypes?.length) {
          urlParams.set('type', searchFilters.contentTypes.join(','));
        }
        if (searchFilters.badges?.length) {
          urlParams.set('badges', searchFilters.badges.join(','));
        }
        if (searchFilters.visibility?.length) {
          urlParams.set('visibility', searchFilters.visibility.join(','));
        }
        if (searchFilters.tags?.length) {
          urlParams.set('tags', searchFilters.tags.join(','));
        }
        if (searchFilters.dateRange?.start) {
          urlParams.set('startDate', searchFilters.dateRange.start.toISOString().split('T')[0]);
        }
        if (searchFilters.dateRange?.end) {
          urlParams.set('endDate', searchFilters.dateRange.end.toISOString().split('T')[0]);
        }
      }

      // Add sort parameter
      if (sort && sort !== 'relevance') {
        urlParams.set('sortBy', sort);
      }

      // Add page parameter
      if (offset > 0) {
        urlParams.set('page', String(Math.floor(offset / resultsPerPage) + 1));
      }

      if (useAdvanced) {
        urlParams.set('mode', 'advanced');
      } else {
        urlParams.delete('mode');
      }

      window.history.replaceState({}, '', `?${urlParams.toString()}`);
    } catch (err) {
      setError('Failed to perform search. Please try again.');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [addToHistory, filters, resultsPerPage, useAdvanced, searchWithinResults, results]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setCurrentPage(1);
      performSearch({ q: query, filters, sortBy });
    }
  };

  const handleFilterChange = (newFilters: SearchFilters) => {
    setFilters(newFilters);
    if (query.trim()) {
      setCurrentPage(1);
      performSearch({ q: query, filters: newFilters, sortBy });
    }
  };

  const handleSortChange = (newSort: 'relevance' | 'date') => {
    setSortBy(newSort);
    if (query.trim()) {
      setCurrentPage(1);
      performSearch({ q: query, filters, sortBy: newSort });
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const offset = (page - 1) * resultsPerPage;
    performSearch({ q: query, filters, sortBy, offset });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveSearch = async () => {
    if (!query.trim()) {
      return;
    }
    const result = await saveSearch({ query, filters, sortBy });
    if (result) {
      setSearchMessage('Search saved successfully.');
    }
  };

  const handleLoadSavedSearch = async (searchId: string) => {
    const savedSearch = await loadSearch(searchId);
    if (!savedSearch) {
      return;
    }

    const rawFilters = (savedSearch.filters ?? {}) as Record<string, unknown>;
    const { __sortBy, ...restFilters } = rawFilters;
    const parsedSort = (__sortBy === 'date' ? 'date' : 'relevance') as 'relevance' | 'date';

    setQuery(savedSearch.query);
    setFilters(restFilters as SearchFilters);
    setSortBy(parsedSort);
    performSearch({
      q: savedSearch.query,
      filters: restFilters as SearchFilters,
      sortBy: parsedSort,
    });
  };

  const handleExportCsv = async () => {
    if (!query.trim()) {
      setSearchMessage('Enter a query before exporting results.');
      return;
    }

    setExporting(true);
    setSearchMessage(null);
    try {
      const withinIds = searchWithinResults && results ? results.items.map(item => item.id) : undefined;
      const client = await loadSharedApiClient();
      const download = await client.exportAdvancedSearchCsv({ query, withinIds });
      downloadBlob(download.blob, download.filename ?? 'search-results.csv');
      setSearchMessage('Search results exported to CSV.');
      client
        .trackAnalyticsEvents({
          eventType: 'export',
          metadata: {
            type: 'search_results',
            query,
            withFilters: Boolean(Object.keys(filters).length),
          },
        })
        .catch(() => {});
    } catch (err) {
      setError('Failed to export search results.');
    } finally {
      setExporting(false);
    }
  };

  const handleClearFilters = () => {
    setFilters({});
    if (query.trim()) {
      performSearch({ q: query, filters: {}, sortBy });
    }
  };

  const fetchSuggestions = useCallback(async (searchQuery: string): Promise<string[]> => {
    // Filter search history to find matching queries
    const history = getHistory();
    const lowerQuery = searchQuery.toLowerCase();

    const matchingQueries = history
      .filter(item => item.query.toLowerCase().includes(lowerQuery))
      .map(item => item.query)
      .filter((query, index, self) => self.indexOf(query) === index) // Remove duplicates
      .slice(0, 5); // Limit to 5 suggestions

    return matchingQueries;
  }, [getHistory]);

  const totalPages = results ? Math.ceil(results.total / resultsPerPage) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Search AWS Community Content</h1>
          <p className="text-gray-600">Find content from AWS Heroes, Community Builders, and more</p>
        </div>

        <SearchBar
          query={query}
          onQueryChange={setQuery}
          onSearch={handleSearch}
          loading={loading}
          searchHistory={getHistory()}
          savedSearches={getSavedSearches().map(s => {
            const rawFilters = (s.filters ?? {}) as Record<string, unknown>;
            const { __sortBy, ...restFilters } = rawFilters;
            return {
              id: s.id,
              query: s.query,
              filters: restFilters as SearchFilters,
              sortBy: (__sortBy === 'date' ? 'date' : 'relevance') as 'relevance' | 'date',
            };
          })}
          onClearHistory={clearHistory}
          onLoadSavedSearch={(id) => {
            void handleLoadSavedSearch(id);
          }}
          onDeleteSavedSearch={(id) => {
            void deleteSavedSearch(id);
          }}
          onFetchSuggestions={fetchSuggestions}
        />

        <div className="flex gap-6 mt-6">
          {/* Mobile Filter Toggle */}
          <button
            className="lg:hidden fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-full shadow-lg z-10"
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Filters"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>

          {/* Filter Sidebar */}
          <div className={`lg:block ${showFilters ? 'block' : 'hidden'}`}>
            <FilterSidebar
              filters={filters}
              onFilterChange={handleFilterChange}
              onClearFilters={handleClearFilters}
              isOpen={showFilters}
              onClose={() => setShowFilters(false)}
            />
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Toolbar */}
            <div className="bg-white p-4 rounded-lg shadow mb-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <label htmlFor="sort-select" className="text-sm font-medium text-gray-700">
                    Sort by:
                  </label>
                  <select
                    id="sort-select"
                    value={sortBy}
                    onChange={(e) => handleSortChange(e.target.value as 'relevance' | 'date')}
                    className="input-field"
                    aria-label="Sort by"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="date">Date (Newest First)</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center text-sm text-gray-600">
                    <input
                      type="checkbox"
                      className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500"
                      checked={useAdvanced}
                      onChange={(e) => setUseAdvanced(e.target.checked)}
                    />
                    Advanced operators
                  </label>
                  <label className="flex items-center text-sm text-gray-600">
                    <input
                      type="checkbox"
                      className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500"
                      checked={searchWithinResults}
                      onChange={(e) => setSearchWithinResults(e.target.checked)}
                      disabled={!results || results.items.length === 0}
                    />
                    Search within results
                  </label>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="btn-secondary"
                    disabled={exporting}
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={handleSaveSearch}
                    className="btn-secondary"
                    disabled={!query.trim()}
                    aria-label="Save search"
                  >
                    Save Search
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Use boolean operators (AND, OR, NOT), exact phrases with quotes, wildcards (*), and save reusable
                queries. Enable "search within results" to refine using the current result set.
              </p>
              {searchMessage && (
                <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  {searchMessage}
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                {error}
              </div>
            )}

            {/* Results */}
            <SearchResults
              results={results}
              loading={loading}
              currentPage={currentPage}
              totalPages={totalPages}
              resultsPerPage={resultsPerPage}
              onPageChange={handlePageChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
