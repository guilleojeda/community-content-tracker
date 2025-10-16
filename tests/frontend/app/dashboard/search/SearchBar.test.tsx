import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchBar from '@/app/dashboard/search/SearchBar';
import { SearchFilters } from '@shared/types';

interface WrapperProps {
  initialQuery?: string;
  searchHistory?: Array<{ query: string; filters: SearchFilters; timestamp: number }>;
  savedSearches?: Array<{ id: string; query: string; filters: SearchFilters; sortBy: string }>;
  onFetchSuggestions?: (query: string) => Promise<string[]>;
  loading?: boolean;
}

const renderSearchBar = ({
  initialQuery = '',
  searchHistory = [],
  savedSearches = [],
  onFetchSuggestions,
  loading = false,
}: WrapperProps = {}) => {
  const onQueryChange = jest.fn();
  const onSearch = jest.fn((event: React.FormEvent) => event.preventDefault());
  const onClearHistory = jest.fn();
  const onLoadSavedSearch = jest.fn();
  const onDeleteSavedSearch = jest.fn();

  const Wrapper = () => {
    const [query, setQuery] = useState(initialQuery);

    const handleQueryChange = (value: string) => {
      setQuery(value);
      onQueryChange(value);
    };

    return (
      <SearchBar
        query={query}
        onQueryChange={handleQueryChange}
        onSearch={onSearch}
        loading={loading}
        searchHistory={searchHistory}
        savedSearches={savedSearches}
        onClearHistory={onClearHistory}
        onLoadSavedSearch={onLoadSavedSearch}
        onDeleteSavedSearch={onDeleteSavedSearch}
        onFetchSuggestions={onFetchSuggestions}
      />
    );
  };

  const utils = render(<Wrapper />);

  return {
    ...utils,
    onQueryChange,
    onSearch,
    onClearHistory,
    onLoadSavedSearch,
    onDeleteSavedSearch,
  };
};

describe('SearchBar', () => {
  it('fetches autocomplete suggestions and allows keyboard selection', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue(['lambda functions', 'lambda layers']);
    const { onQueryChange } = renderSearchBar({
      initialQuery: 'lam',
      onFetchSuggestions: fetchSuggestions,
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'lambda' } });

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledWith('lambda');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onQueryChange).toHaveBeenLastCalledWith('lambda functions');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes suggestions with escape key and supports mouse selection', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue(['aws hero', 'aws community']);
    renderSearchBar({
      initialQuery: 'aw',
      onFetchSuggestions: fetchSuggestions,
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'aws' } });

    await waitFor(() => {
      expect(screen.getByText('aws hero')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'aws ' } });
    await waitFor(() => {
      expect(screen.getByText('aws community')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aws community'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('displays search history on focus and clears history', () => {
    const history = [
      { query: 'lambda', filters: {}, timestamp: Date.now() },
      { query: 'containers', filters: {}, timestamp: Date.now() },
    ];

    const { onClearHistory, onQueryChange } = renderSearchBar({
      searchHistory: history,
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    fireEvent.focus(input);

    expect(screen.getByText(/recent searches/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear history/i }));
    expect(onClearHistory).toHaveBeenCalled();

    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('lambda'));
    expect(onQueryChange).toHaveBeenCalledWith('lambda');
  });

  it('loads and deletes saved searches', () => {
    const saved = [
      { id: '1', query: 'serverless', filters: {}, sortBy: 'relevance' },
      { id: '2', query: 'observability', filters: {}, sortBy: 'date' },
    ];

    const { onLoadSavedSearch, onDeleteSavedSearch } = renderSearchBar({
      savedSearches: saved,
    });

    fireEvent.click(screen.getByRole('button', { name: /saved searches/i }));
    fireEvent.click(screen.getByText('serverless'));
    expect(onLoadSavedSearch).toHaveBeenCalledWith('1');

    fireEvent.click(screen.getByRole('button', { name: /saved searches/i }));
    fireEvent.click(screen.getAllByLabelText(/delete saved search/i)[0]);
    expect(onDeleteSavedSearch).toHaveBeenCalledWith('1');
  });

  it('disables search button while loading or empty query', () => {
    const { unmount } = renderSearchBar({ initialQuery: '' });
    const submit = screen.getByRole('button', { name: /search/i });
    expect(submit).toBeDisabled();

    unmount();
    renderSearchBar({ initialQuery: 'amplify', loading: true });
    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled();
  });

  it('closes history and saved dropdowns when clicking outside', async () => {
    renderSearchBar({
      searchHistory: [{ query: 'lambda', filters: {}, timestamp: Date.now() }],
      savedSearches: [{ id: '1', query: 'serverless', filters: {}, sortBy: 'relevance' }],
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    fireEvent.focus(input);
    expect(screen.getByText(/recent searches/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /saved searches/i }));
    expect(screen.getByText(/saved searches \(1\)/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /saved searches/i })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText(/recent searches/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /saved searches/i })).not.toBeInTheDocument();
    });
  });

  it('skips suggestion fetch immediately after manual selection', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue(['lambda functions']);
    renderSearchBar({
      initialQuery: '',
      onFetchSuggestions: fetchSuggestions,
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'lambda' } });

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledTimes(1);
      expect(screen.getByText('lambda functions')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('lambda functions'));

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledTimes(1);
      expect(input).toHaveValue('lambda functions');
    });

    fireEvent.change(input, { target: { value: 'lambda functions!' } });

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledTimes(2);
    });
  });

  it('debounces suggestion fetch outside the test environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    jest.useFakeTimers();
    process.env.NODE_ENV = 'development';

    const fetchSuggestions = jest.fn().mockResolvedValue(['aws hero']);
    const { unmount } = renderSearchBar({
      initialQuery: '',
      onFetchSuggestions: fetchSuggestions,
    });

    try {
      const input = screen.getByRole('combobox', { name: /search/i });
      fireEvent.change(input, { target: { value: 'aw' } });

      expect(fetchSuggestions).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
      });

      expect(fetchSuggestions).toHaveBeenCalledTimes(1);

      fireEvent.change(input, { target: { value: 'aws' } });
      expect(fetchSuggestions).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
      });

      expect(fetchSuggestions).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      await act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
      jest.useRealTimers();
      process.env.NODE_ENV = originalEnv;
    }
  });
});
