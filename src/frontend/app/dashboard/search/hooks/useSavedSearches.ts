'use client';

import { useCallback, useEffect, useState } from 'react';
import { SearchFilters } from '@shared/types';
import type { SavedSearchEntry, SavedSearchListResponse } from '@/api';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

interface SaveSearchInput {
  query: string;
  filters?: SearchFilters;
  sortBy?: 'relevance' | 'date';
  name?: string;
}

export function useSavedSearches() {
  const [savedSearches, setSavedSearches] = useState<SavedSearchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedSearches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await loadSharedApiClient();
      const response: SavedSearchListResponse = await client.getSavedSearches();
      setSavedSearches(response.searches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved searches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedSearches();
  }, [loadSavedSearches]);

  const buildFiltersPayload = (
    filters: SearchFilters | undefined,
    sortBy: 'relevance' | 'date' | undefined
  ): Record<string, unknown> => ({
    ...(filters ?? {}),
    __sortBy: sortBy ?? 'relevance',
  });

  const saveSearch = useCallback(
    async (search: SaveSearchInput) => {
      if (!search.query.trim()) {
        return null;
      }

      try {
        const name = search.name || search.query;
        const filtersPayload = buildFiltersPayload(search.filters, search.sortBy);
        const existing = savedSearches.find(
          entry =>
            entry.query.toLowerCase() === search.query.toLowerCase() &&
            JSON.stringify(entry.filters ?? {}) === JSON.stringify(filtersPayload)
        );

        const client = await loadSharedApiClient();
        if (existing) {
          const updated = await client.updateSavedSearch(existing.id, {
            name,
            query: search.query,
            filters: filtersPayload,
            isPublic: false,
          });
          setSavedSearches(prev =>
            prev.map(entry => (entry.id === existing.id ? updated : entry))
          );
          return updated;
        }

        const created = await client.saveSearch({
          name,
          query: search.query,
          filters: filtersPayload,
          isPublic: false,
        });
        setSavedSearches(prev => [created, ...prev]);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save search');
        return null;
      }
    },
    [savedSearches]
  );

  const deleteSavedSearch = useCallback(async (id: string) => {
    try {
      const client = await loadSharedApiClient();
      await client.deleteSavedSearch(id);
      setSavedSearches(prev => prev.filter(entry => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved search');
    }
  }, []);

  const loadSearch = useCallback(
    async (id: string): Promise<SavedSearchEntry | null> => {
      const existing = savedSearches.find(entry => entry.id === id);
      if (existing) {
        return existing;
      }

      try {
        const client = await loadSharedApiClient();
        const fetched = await client.getSavedSearch(id);
        setSavedSearches(prev => {
          const without = prev.filter(entry => entry.id !== fetched.id);
          return [fetched, ...without];
        });
        return fetched;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load saved search');
        return null;
      }
    },
    [savedSearches]
  );

  const getSavedSearches = useCallback(() => savedSearches, [savedSearches]);

  const updateSavedSearch = useCallback(
    async (id: string, updates: Partial<SaveSearchInput>) => {
      try {
        const filtersPayload = buildFiltersPayload(
          updates.filters as SearchFilters | undefined,
          updates.sortBy
        );
        const client = await loadSharedApiClient();
        const updated = await client.updateSavedSearch(id, {
          name: updates.name,
          query: updates.query,
          filters: filtersPayload,
          isPublic: false,
        });
        setSavedSearches(prev => prev.map(entry => (entry.id === id ? updated : entry)));
        return updated;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update saved search');
        return null;
      }
    },
    []
  );

  return {
    loading,
    error,
    saveSearch,
    deleteSavedSearch,
    loadSearch,
    getSavedSearches,
    updateSavedSearch,
    refresh: loadSavedSearches,
  };
}
