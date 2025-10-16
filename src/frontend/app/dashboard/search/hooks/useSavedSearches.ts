'use client';

import { useState, useEffect } from 'react';
import { SearchFilters } from '@shared/types';

interface SavedSearch {
  id: string;
  query: string;
  filters?: SearchFilters;
  sortBy?: 'relevance' | 'date';
  savedAt: number;
  name?: string;
}

const STORAGE_KEY = 'aws_community_saved_searches';
const MAX_SAVED = 20;

export function useSavedSearches() {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  useEffect(() => {
    // Load saved searches from localStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSavedSearches(Array.isArray(parsed) ? parsed : []);
        }
      } catch (e) {
        console.error('Failed to parse saved searches from localStorage', e);
        // Clear corrupted data
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const saveSearch = (search: Omit<SavedSearch, 'id' | 'savedAt'>) => {
    if (typeof window === 'undefined' || !search.query.trim()) {
      return;
    }

    try {
      // Check if we've already saved this exact query
      const existingIndex = savedSearches.findIndex(
        s => s.query.toLowerCase() === search.query.toLowerCase()
      );

      let newSavedSearches: SavedSearch[];

      if (existingIndex !== -1) {
        // Update existing saved search
        newSavedSearches = [...savedSearches];
        newSavedSearches[existingIndex] = {
          ...newSavedSearches[existingIndex],
          ...search,
          savedAt: Date.now(),
        };
      } else {
        // Create new saved search
        const newSearch: SavedSearch = {
          ...search,
          id: `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          savedAt: Date.now(),
        };

        newSavedSearches = [newSearch, ...savedSearches].slice(0, MAX_SAVED);
      }

      setSavedSearches(newSavedSearches);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedSearches));
    } catch (e) {
      console.error('Failed to save search to localStorage', e);
    }
  };

  const deleteSavedSearch = (id: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const newSavedSearches = savedSearches.filter(s => s.id !== id);
      setSavedSearches(newSavedSearches);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedSearches));
    } catch (e) {
      console.error('Failed to delete saved search', e);
    }
  };

  const loadSearch = (id: string): SavedSearch | undefined => {
    return savedSearches.find(s => s.id === id);
  };

  const getSavedSearches = () => savedSearches;

  const updateSavedSearch = (id: string, updates: Partial<SavedSearch>) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const newSavedSearches = savedSearches.map(s =>
        s.id === id ? { ...s, ...updates, savedAt: Date.now() } : s
      );
      setSavedSearches(newSavedSearches);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedSearches));
    } catch (e) {
      console.error('Failed to update saved search', e);
    }
  };

  return {
    saveSearch,
    deleteSavedSearch,
    loadSearch,
    getSavedSearches,
    updateSavedSearch,
  };
}
