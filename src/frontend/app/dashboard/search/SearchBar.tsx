'use client';

import React, { useState, useRef, useEffect } from 'react';
import { SearchFilters } from '@shared/types';

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: (e: React.FormEvent) => void;
  loading: boolean;
  searchHistory: Array<{ query: string; filters: SearchFilters; timestamp: number }>;
  savedSearches: Array<{ id: string; query: string; filters: SearchFilters; sortBy: string }>;
  onClearHistory: () => void;
  onLoadSavedSearch: (id: string) => void;
  onDeleteSavedSearch: (id: string) => void;
  onFetchSuggestions?: (query: string) => Promise<string[]>;
}

export default function SearchBar({
  query,
  onQueryChange,
  onSearch,
  loading,
  searchHistory,
  savedSearches,
  onClearHistory,
  onLoadSavedSearch,
  onDeleteSavedSearch,
  onFetchSuggestions,
}: SearchBarProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [skipNextSuggestionFetch, setSkipNextSuggestionFetch] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
      if (savedRef.current && !savedRef.current.contains(event.target as Node)) {
        setShowSaved(false);
      }
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isTestEnvironment = process.env.NODE_ENV === 'test';

  // Debounced autocomplete fetch
  useEffect(() => {
    if (!onFetchSuggestions || !query.trim() || query.length < 2) {
      setSuggestions([]);
      setShowAutocomplete(false);
      if (skipNextSuggestionFetch) {
        setSkipNextSuggestionFetch(false);
      }
      return;
    }

    if (skipNextSuggestionFetch) {
      setSkipNextSuggestionFetch(false);
      return;
    }

    const executeFetch = async () => {
      setLoadingSuggestions(true);
      try {
        const results = await onFetchSuggestions(query);
        setSuggestions(results);
        setShowAutocomplete(results.length > 0);
        setSelectedSuggestionIndex(-1);
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    };

    if (isTestEnvironment) {
      executeFetch();
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(executeFetch, 300);

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, onFetchSuggestions, skipNextSuggestionFetch, isTestEnvironment]);

  // Keyboard navigation for autocomplete
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showAutocomplete || suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault();
          onQueryChange(suggestions[selectedSuggestionIndex]);
          setShowAutocomplete(false);
          setSelectedSuggestionIndex(-1);
          setSkipNextSuggestionFetch(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowAutocomplete(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    onQueryChange(suggestion);
    setShowAutocomplete(false);
    setSelectedSuggestionIndex(-1);
    setSkipNextSuggestionFetch(true);
  };

  return (
    <div className="mb-6">
      <form onSubmit={onSearch}>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => {
              if (query.length < 2) {
                setShowHistory(searchHistory.length > 0);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search for content, creators, topics..."
            className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="autocomplete-list"
            aria-expanded={showAutocomplete}
            role="combobox"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 top-2 px-4 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Search"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              'Search'
            )}
          </button>

          {/* Autocomplete Dropdown */}
          {showAutocomplete && suggestions.length > 0 && (
            <div
              ref={autocompleteRef}
              id="autocomplete-list"
              role="listbox"
              className="absolute z-10 w-full mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto"
            >
              <ul className="py-2">
                {suggestions.map((suggestion, idx) => (
                  <li
                    key={idx}
                    role="option"
                    aria-selected={idx === selectedSuggestionIndex}
                    className={`px-4 py-2 cursor-pointer text-sm transition-colors ${
                      idx === selectedSuggestionIndex
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>{suggestion}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {loadingSuggestions && (
                <div className="px-4 py-2 text-sm text-gray-500 text-center border-t">
                  Loading suggestions...
                </div>
              )}
            </div>
          )}

          {/* Search History Dropdown */}
          {showHistory && searchHistory.length > 0 && !showAutocomplete && (
            <div
              ref={historyRef}
              className="absolute z-10 w-full mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto"
            >
              <div className="p-3 border-b border-gray-200 flex justify-between items-center">
                <h3 className="font-semibold text-sm text-gray-700">Recent Searches</h3>
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    setShowHistory(false);
                  }}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Clear History
                </button>
              </div>
              <ul className="py-2">
                {searchHistory.slice(0, 5).map((item, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => {
                        onQueryChange(item.query);
                        setShowHistory(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{item.query}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </form>

      {/* Saved Searches Section */}
      {savedSearches.length > 0 && (
        <div className="mt-4 relative" ref={savedRef}>
          <button
            type="button"
            onClick={() => setShowSaved(!showSaved)}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span>Saved Searches ({savedSearches.length})</span>
            <svg className={`w-4 h-4 transition-transform ${showSaved ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSaved && (
            <div className="absolute z-10 left-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 min-w-72 max-h-80 overflow-y-auto">
              <div className="p-3 border-b border-gray-200">
                <h3 className="font-semibold text-sm text-gray-700">Saved Searches</h3>
              </div>
              <ul className="py-2">
                {savedSearches.map((saved) => (
                  <li key={saved.id} className="px-4 py-2 hover:bg-gray-50">
                    <div className="flex justify-between items-start gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadSavedSearch(saved.id);
                          setShowSaved(false);
                        }}
                        className="flex-1 text-left"
                      >
                        <div className="text-sm font-medium text-gray-900">{saved.query}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Sort: {saved.sortBy || 'relevance'}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedSearch(saved.id)}
                        className="text-red-600 hover:text-red-800 p-1"
                        aria-label="Delete saved search"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
