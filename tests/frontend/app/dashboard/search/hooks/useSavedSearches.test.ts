import { renderHook, act, waitFor } from '@testing-library/react';
import { useSavedSearches } from '@/app/dashboard/search/hooks/useSavedSearches';
import { SavedSearchEntry } from '@/api';

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return {
    ...actual,
    apiClient: {
      getSavedSearches: jest.fn(),
      saveSearch: jest.fn(),
      updateSavedSearch: jest.fn(),
      deleteSavedSearch: jest.fn(),
      getSavedSearch: jest.fn(),
    },
  };
});

const mockedApiClient = require('@/api/client').apiClient as jest.Mocked<typeof import('@/api/client').apiClient>;

describe('useSavedSearches', () => {
  const sampleSearch: SavedSearchEntry = {
    id: '1',
    userId: 'user-1',
    name: 'Test Query',
    query: 'aws lambda',
    filters: { __sortBy: 'relevance' },
    isPublic: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiClient.getSavedSearches.mockResolvedValue({ searches: [], count: 0 });
  });

  it('loads saved searches on mount', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValue({ searches: [sampleSearch], count: 1 });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getSavedSearches()).toEqual([sampleSearch]);
  });

  it('handles errors when loading saved searches', async () => {
    mockedApiClient.getSavedSearches.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
  });

  it('saves a new search via API and updates state', async () => {
    mockedApiClient.saveSearch.mockResolvedValue(sampleSearch);

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSearch({ query: 'aws lambda', filters: {}, sortBy: 'relevance' });
    });

    expect(mockedApiClient.saveSearch).toHaveBeenCalledWith({
      name: 'aws lambda',
      query: 'aws lambda',
      filters: { __sortBy: 'relevance' },
      isPublic: false,
    });
    expect(result.current.getSavedSearches()).toHaveLength(1);
  });

  it('updates an existing saved search when query matches', async () => {
    const existing = { ...sampleSearch };
    mockedApiClient.getSavedSearches.mockResolvedValue({ searches: [existing], count: 1 });
    mockedApiClient.updateSavedSearch.mockResolvedValue({ ...existing, name: 'Updated' });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSearch({ query: existing.query, filters: {}, sortBy: 'relevance', name: 'Updated' });
    });

    expect(mockedApiClient.updateSavedSearch).toHaveBeenCalled();
    expect(result.current.getSavedSearches()[0].name).toBe('Updated');
  });

  it('deletes a saved search via API', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValue({ searches: [sampleSearch], count: 1 });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteSavedSearch(sampleSearch.id);
    });

    expect(mockedApiClient.deleteSavedSearch).toHaveBeenCalledWith(sampleSearch.id);
    expect(result.current.getSavedSearches()).toHaveLength(0);
  });

  it('loads a saved search by id if not present in state', async () => {
    mockedApiClient.getSavedSearch.mockResolvedValue(sampleSearch);

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let loaded: SavedSearchEntry | null = null;
    await act(async () => {
      loaded = await result.current.loadSearch(sampleSearch.id);
    });

    expect(mockedApiClient.getSavedSearch).toHaveBeenCalledWith(sampleSearch.id);
    expect(loaded).toEqual(sampleSearch);
    expect(result.current.getSavedSearches()).toContainEqual(sampleSearch);
  });

  it('returns null without calling API when query is blank', async () => {
    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response: SavedSearchEntry | null = null;
    await act(async () => {
      response = await result.current.saveSearch({ query: '   ' });
    });

    expect(response).toBeNull();
    expect(mockedApiClient.saveSearch).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('sets error state when saveSearch API call fails', async () => {
    mockedApiClient.saveSearch.mockRejectedValueOnce(new Error('Save failed'));

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSearch({ query: 'aws blogs', filters: { badges: [] }, sortBy: 'relevance' });
    });

    expect(mockedApiClient.saveSearch).toHaveBeenCalled();
    expect(result.current.error).toBe('Save failed');
  });

  it('returns cached saved search without refetching when available locally', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValueOnce({ searches: [sampleSearch], count: 1 });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedApiClient.getSavedSearch.mockClear();

    let loaded: SavedSearchEntry | null = null;
    await act(async () => {
      loaded = await result.current.loadSearch(sampleSearch.id);
    });

    expect(mockedApiClient.getSavedSearch).not.toHaveBeenCalled();
    expect(loaded).toEqual(sampleSearch);
  });

  it('updates a saved search with new filters and sort order via updateSavedSearch helper', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValueOnce({ searches: [sampleSearch], count: 1 });
    mockedApiClient.updateSavedSearch.mockResolvedValue({
      ...sampleSearch,
      id: sampleSearch.id,
      name: 'Renamed',
      query: 'aws compute',
      filters: { __sortBy: 'date', tags: ['compute'] },
    });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSavedSearch(sampleSearch.id, {
        name: 'Renamed',
        query: 'aws compute',
        filters: { tags: ['compute'] },
        sortBy: 'date',
      });
    });

    expect(mockedApiClient.updateSavedSearch).toHaveBeenCalledWith(sampleSearch.id, {
      name: 'Renamed',
      query: 'aws compute',
      filters: { tags: ['compute'], __sortBy: 'date' },
      isPublic: false,
    });
    expect(result.current.getSavedSearches()[0].name).toBe('Renamed');
    expect(result.current.getSavedSearches()[0].filters).toEqual({ __sortBy: 'date', tags: ['compute'] });
  });

  it('captures errors during updateSavedSearch helper execution', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValueOnce({ searches: [sampleSearch], count: 1 });
    mockedApiClient.updateSavedSearch.mockRejectedValueOnce(new Error('Update failed'));

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: SavedSearchEntry | null = null;
    await act(async () => {
      updated = await result.current.updateSavedSearch(sampleSearch.id, { query: 'aws compute' });
    });

    expect(updated).toBeNull();
    expect(result.current.error).toBe('Update failed');
  });
});
