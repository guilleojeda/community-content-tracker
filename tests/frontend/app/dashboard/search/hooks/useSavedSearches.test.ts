import { renderHook, act } from '@testing-library/react';
import { useSavedSearches } from '@/app/dashboard/search/hooks/useSavedSearches';

describe('useSavedSearches', () => {
  const STORAGE_KEY = 'aws_community_saved_searches';

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization', () => {
    it('should initialize with empty saved searches', () => {
      const { result } = renderHook(() => useSavedSearches());
      expect(result.current.getSavedSearches()).toEqual([]);
    });

    it('should load saved searches from localStorage on mount', () => {
      const mockSavedSearches = [
        {
          id: 'search_1',
          query: 'test query',
          filters: {},
          sortBy: 'relevance' as const,
          savedAt: Date.now(),
        },
        {
          id: 'search_2',
          query: 'another query',
          filters: {},
          sortBy: 'date' as const,
          savedAt: Date.now() - 1000,
        },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockSavedSearches));

      const { result } = renderHook(() => useSavedSearches());
      expect(result.current.getSavedSearches()).toEqual(mockSavedSearches);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json');
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const { result } = renderHook(() => useSavedSearches());
      expect(result.current.getSavedSearches()).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to parse saved searches from localStorage',
        expect.any(Error)
      );
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-array data in localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'array' }));

      const { result } = renderHook(() => useSavedSearches());
      expect(result.current.getSavedSearches()).toEqual([]);
    });
  });

  describe('saveSearch', () => {
    it('should save new search', () => {
      const { result } = renderHook(() => useSavedSearches());
      const newSearch = { query: 'test query', filters: {}, sortBy: 'relevance' as const };

      act(() => {
        result.current.saveSearch(newSearch);
      });

      const savedSearches = result.current.getSavedSearches();
      expect(savedSearches).toHaveLength(1);
      expect(savedSearches[0]).toMatchObject(newSearch);
      expect(savedSearches[0].id).toBeDefined();
      expect(savedSearches[0].savedAt).toBeDefined();
    });

    it('should save search to localStorage', () => {
      const { result } = renderHook(() => useSavedSearches());
      const newSearch = { query: 'test query', filters: {}, sortBy: 'date' as const };

      act(() => {
        result.current.saveSearch(newSearch);
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject(newSearch);
    });

    it('should not save empty query', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: '', filters: {}, sortBy: 'relevance' as const });
      });

      expect(result.current.getSavedSearches()).toHaveLength(0);
    });

    it('should not save whitespace-only query', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: '   ', filters: {}, sortBy: 'relevance' as const });
      });

      expect(result.current.getSavedSearches()).toHaveLength(0);
    });

    it('should update existing search when same query exists (case-insensitive)', () => {
      const { result } = renderHook(() => useSavedSearches());
      const search1 = { query: 'Test Query', filters: { type: 'blog' }, sortBy: 'relevance' as const };
      const search2 = { query: 'test query', filters: { type: 'video' }, sortBy: 'date' as const };

      act(() => {
        result.current.saveSearch(search1);
      });

      const firstSave = result.current.getSavedSearches();
      const firstId = firstSave[0].id;

      act(() => {
        result.current.saveSearch(search2);
      });

      const savedSearches = result.current.getSavedSearches();
      expect(savedSearches).toHaveLength(1);
      expect(savedSearches[0].id).toBe(firstId); // Same ID
      expect(savedSearches[0].sortBy).toBe('date'); // Updated
      expect(savedSearches[0].filters).toEqual({ type: 'video' }); // Updated
    });

    it('should add new searches to the beginning', () => {
      const { result } = renderHook(() => useSavedSearches());
      const search1 = { query: 'first', filters: {}, sortBy: 'relevance' as const };
      const search2 = { query: 'second', filters: {}, sortBy: 'date' as const };

      act(() => {
        result.current.saveSearch(search1);
      });

      act(() => {
        result.current.saveSearch(search2);
      });

      const savedSearches = result.current.getSavedSearches();
      expect(savedSearches[0].query).toBe('second');
      expect(savedSearches[1].query).toBe('first');
    });

    it('should limit saved searches to MAX_SAVED items', () => {
      const { result } = renderHook(() => useSavedSearches());

      // Add 25 searches (MAX_SAVED is 20)
      for (let i = 0; i < 25; i++) {
        act(() => {
          result.current.saveSearch({
            query: `query ${i}`,
            filters: {},
            sortBy: 'relevance' as const,
          });
        });
      }

      const savedSearches = result.current.getSavedSearches();
      expect(savedSearches).toHaveLength(20);
      expect(savedSearches[0].query).toBe('query 24'); // Most recent
      expect(savedSearches[19].query).toBe('query 5'); // Oldest kept
    });

    it('should handle localStorage write errors', () => {
      const { result } = renderHook(() => useSavedSearches());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock localStorage.setItem to throw error
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('Storage full');
      });

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save search to localStorage',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('deleteSavedSearch', () => {
    it('should delete saved search by ID', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test 1', filters: {}, sortBy: 'relevance' as const });
      });

      act(() => {
        result.current.saveSearch({ query: 'test 2', filters: {}, sortBy: 'date' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const idToDelete = savedSearches[0].id;

      act(() => {
        result.current.deleteSavedSearch(idToDelete);
      });

      const remaining = result.current.getSavedSearches();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).not.toBe(idToDelete);
    });

    it('should update localStorage after deletion', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const idToDelete = savedSearches[0].id;

      act(() => {
        result.current.deleteSavedSearch(idToDelete);
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(0);
    });

    it('should handle non-existent ID gracefully', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      act(() => {
        result.current.deleteSavedSearch('non-existent-id');
      });

      expect(result.current.getSavedSearches()).toHaveLength(1);
    });

    it('should handle localStorage write errors', () => {
      const { result } = renderHook(() => useSavedSearches());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const idToDelete = savedSearches[0].id;

      // Mock localStorage.setItem to throw error
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('Storage full');
      });

      act(() => {
        result.current.deleteSavedSearch(idToDelete);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to delete saved search',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('loadSearch', () => {
    it('should load saved search by ID', () => {
      const { result } = renderHook(() => useSavedSearches());
      const search = { query: 'test', filters: { type: 'blog' }, sortBy: 'relevance' as const };

      act(() => {
        result.current.saveSearch(search);
      });

      const savedSearches = result.current.getSavedSearches();
      const searchId = savedSearches[0].id;

      const loaded = result.current.loadSearch(searchId);
      expect(loaded).toBeDefined();
      expect(loaded?.query).toBe('test');
      expect(loaded?.filters).toEqual({ type: 'blog' });
    });

    it('should return undefined for non-existent ID', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const loaded = result.current.loadSearch('non-existent-id');
      expect(loaded).toBeUndefined();
    });
  });

  describe('updateSavedSearch', () => {
    it('should update saved search by ID', async () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const searchId = savedSearches[0].id;
      const originalSavedAt = savedSearches[0].savedAt;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      act(() => {
        result.current.updateSavedSearch(searchId, {
          name: 'My Favorite Search',
          sortBy: 'date' as const,
        });
      });

      const updated = result.current.getSavedSearches()[0];
      expect(updated.id).toBe(searchId);
      expect(updated.name).toBe('My Favorite Search');
      expect(updated.sortBy).toBe('date');
      expect(updated.query).toBe('test'); // Unchanged
      expect(updated.savedAt).toBeGreaterThan(originalSavedAt); // Updated timestamp
    });

    it('should update localStorage after update', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const searchId = savedSearches[0].id;

      act(() => {
        result.current.updateSavedSearch(searchId, { name: 'Updated Name' });
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored[0].name).toBe('Updated Name');
    });

    it('should handle non-existent ID gracefully', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const before = result.current.getSavedSearches();

      act(() => {
        result.current.updateSavedSearch('non-existent-id', { name: 'New Name' });
      });

      const after = result.current.getSavedSearches();
      expect(after).toEqual(before); // No changes
    });

    it('should handle localStorage write errors', () => {
      const { result } = renderHook(() => useSavedSearches());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      act(() => {
        result.current.saveSearch({ query: 'test', filters: {}, sortBy: 'relevance' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      const searchId = savedSearches[0].id;

      // Mock localStorage.setItem to throw error
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('Storage full');
      });

      act(() => {
        result.current.updateSavedSearch(searchId, { name: 'New Name' });
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to update saved search',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('getSavedSearches', () => {
    it('should return all saved searches', () => {
      const { result } = renderHook(() => useSavedSearches());

      act(() => {
        result.current.saveSearch({ query: 'test 1', filters: {}, sortBy: 'relevance' as const });
      });

      act(() => {
        result.current.saveSearch({ query: 'test 2', filters: {}, sortBy: 'date' as const });
      });

      const savedSearches = result.current.getSavedSearches();
      expect(savedSearches).toHaveLength(2);
    });
  });
});
