'use client';

import { useState, useEffect } from 'react';
import { SearchFilters } from '@shared/types';

interface SearchHistoryItem {
  query: string;
  filters: SearchFilters;
  timestamp: number;
}

const STORAGE_KEY = 'aws_community_search_history';
const MAX_HISTORY = 10;

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  useEffect(() => {
    /* istanbul ignore next */
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      console.error('Failed to parse search history from localStorage', e);
      // Clear corrupted data
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const addToHistory = (item: SearchHistoryItem) => {
    /* istanbul ignore next */
    if (typeof window === 'undefined' || !item.query.trim()) {
      return;
    }

    try {
      // Remove duplicates and add new item to the beginning
      const newHistory = [
        item,
        ...history.filter(h => h.query.toLowerCase() !== item.query.toLowerCase())
      ].slice(0, MAX_HISTORY);

      setHistory(newHistory);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.error('Failed to save search history to localStorage', e);
    }
  };

  const clearHistory = () => {
    /* istanbul ignore next */
    if (typeof window === 'undefined') {
      return;
    }

    try {
      setHistory([]);
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear search history', e);
    }
  };

  const getHistory = () => history;

  const removeFromHistory = (timestamp: number) => {
    /* istanbul ignore next */
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const newHistory = history.filter(h => h.timestamp !== timestamp);
      setHistory(newHistory);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.error('Failed to remove item from search history', e);
    }
  };

  return {
    addToHistory,
    clearHistory,
    getHistory,
    removeFromHistory,
  };
}
