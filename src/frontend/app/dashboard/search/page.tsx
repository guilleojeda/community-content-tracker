'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/api/client';
import { BadgeType, ContentType, Visibility, SearchFilters } from '@shared/types';
import FilterSidebar from './FilterSidebar';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import { useSearchHistory } from './hooks/useSearchHistory';
import { useSavedSearches } from './hooks/useSavedSearches';
import type { components as ApiComponents } from '@/api';

interface SearchParams {
  q: string;
  filters?: SearchFilters;
  sortBy?: 'relevance' | 'date';
  limit?: number;
  offset?: number;
}

type ApiSearchResponse = ApiComponents['schemas']['SearchResponse'];

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

    // Set state from URL
    if (q) setQuery(q);
    if (Object.keys(urlFilters).length > 0) setFilters(urlFilters);
    if (urlSort) setSortBy(urlSort);
    if (page) setCurrentPage(parseInt(page, 10));

    // Perform search if query exists
    if (q) {
      const offset = page ? (parseInt(page, 10) - 1) * resultsPerPage : 0;
      performSearch({ q, filters: urlFilters, sortBy: urlSort || 'relevance', offset });
    }
  }, []);

  const performSearch = useCallback(async (params: SearchParams) => {
    setLoading(true);
    setError(null);

    try {
      const { q, filters: searchFilters, sortBy: sort } = params;
      const offset = params.offset ?? 0;

      // Build API request with proper types
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

      const data = await apiClient.search(apiParams);
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

      const normalized: ApiSearchResponse = {
        items: normalizedItems,
        total: raw.total ?? normalizedItems.length,
        limit: raw.limit ?? resultsPerPage,
        offset: raw.offset ?? offset,
      };

      setResults(normalized);

      // Add to search history
      addToHistory({ query: q, filters: searchFilters || {}, timestamp: Date.now() });

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

      window.history.replaceState({}, '', `?${urlParams.toString()}`);
    } catch (err) {
      setError('Failed to perform search. Please try again.');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [addToHistory, resultsPerPage]);

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

  const handleSaveSearch = () => {
    if (query.trim()) {
      saveSearch({ query, filters, sortBy });
    }
  };

  const handleLoadSavedSearch = (searchId: string) => {
    const savedSearch = loadSearch(searchId);
    if (savedSearch) {
      setQuery(savedSearch.query);
      setFilters(savedSearch.filters || {});
      setSortBy(savedSearch.sortBy || 'relevance');
      performSearch({
        q: savedSearch.query,
        filters: savedSearch.filters,
        sortBy: savedSearch.sortBy,
      });
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
          savedSearches={getSavedSearches().map(s => ({
            ...s,
            filters: s.filters || {},
            sortBy: s.sortBy || 'relevance'
          }))}
          onClearHistory={clearHistory}
          onLoadSavedSearch={handleLoadSavedSearch}
          onDeleteSavedSearch={deleteSavedSearch}
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
            <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-center justify-between gap-4">
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

              <button
                onClick={handleSaveSearch}
                className="btn-secondary"
                disabled={!query.trim()}
                aria-label="Save search"
              >
                Save Search
              </button>
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
