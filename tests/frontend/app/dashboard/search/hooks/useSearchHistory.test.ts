import { renderHook, act } from '@testing-library/react';
import { useSearchHistory } from '@/app/dashboard/search/hooks/useSearchHistory';

describe('useSearchHistory', () => {
  const STORAGE_KEY = 'aws_community_search_history';

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization', () => {
    it('should initialize with empty history', () => {
      const { result } = renderHook(() => useSearchHistory());
      expect(result.current.getHistory()).toEqual([]);
    });

    it('should load history from localStorage on mount', () => {
      const mockHistory = [
        { query: 'test query', filters: {}, timestamp: Date.now() },
        { query: 'another query', filters: {}, timestamp: Date.now() - 1000 },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockHistory));

      const { result } = renderHook(() => useSearchHistory());
      expect(result.current.getHistory()).toEqual(mockHistory);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json');
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const { result } = renderHook(() => useSearchHistory());
      expect(result.current.getHistory()).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to parse search history from localStorage',
        expect.any(Error)
      );
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-array data in localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'array' }));

      const { result } = renderHook(() => useSearchHistory());
      expect(result.current.getHistory()).toEqual([]);
    });

  });

  describe('addToHistory', () => {
    it('should add item to history', () => {
      const { result } = renderHook(() => useSearchHistory());
      const newItem = { query: 'test query', filters: {}, timestamp: Date.now() };

      act(() => {
        result.current.addToHistory(newItem);
      });

      const history = result.current.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(newItem);
    });

    it('should save history to localStorage', () => {
      const { result } = renderHook(() => useSearchHistory());
      const newItem = { query: 'test query', filters: {}, timestamp: Date.now() };

      act(() => {
        result.current.addToHistory(newItem);
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(newItem);
    });

    it('should not add empty query to history', () => {
      const { result } = renderHook(() => useSearchHistory());

      act(() => {
        result.current.addToHistory({ query: '', filters: {}, timestamp: Date.now() });
      });

      expect(result.current.getHistory()).toHaveLength(0);
    });

    it('should not add whitespace-only query to history', () => {
      const { result } = renderHook(() => useSearchHistory());

      act(() => {
        result.current.addToHistory({ query: '   ', filters: {}, timestamp: Date.now() });
      });

      expect(result.current.getHistory()).toHaveLength(0);
    });

    it('should remove duplicate queries (case-insensitive)', () => {
      const { result } = renderHook(() => useSearchHistory());
      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 1000;

      act(() => {
        result.current.addToHistory({ query: 'Test Query', filters: {}, timestamp: timestamp1 });
      });

      act(() => {
        result.current.addToHistory({ query: 'test query', filters: {}, timestamp: timestamp2 });
      });

      const history = result.current.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].timestamp).toBe(timestamp2);
    });

    it('should add new items to the beginning of history', () => {
      const { result } = renderHook(() => useSearchHistory());
      const item1 = { query: 'first', filters: {}, timestamp: Date.now() };
      const item2 = { query: 'second', filters: {}, timestamp: Date.now() + 1000 };

      act(() => {
        result.current.addToHistory(item1);
      });

      act(() => {
        result.current.addToHistory(item2);
      });

      const history = result.current.getHistory();
      expect(history[0]).toEqual(item2);
      expect(history[1]).toEqual(item1);
    });

    it('should limit history to MAX_HISTORY items', () => {
      const { result } = renderHook(() => useSearchHistory());

      // Add 15 items (MAX_HISTORY is 10)
      for (let i = 0; i < 15; i++) {
        act(() => {
          result.current.addToHistory({
            query: `query ${i}`,
            filters: {},
            timestamp: Date.now() + i,
          });
        });
      }

      const history = result.current.getHistory();
      expect(history).toHaveLength(10);
      expect(history[0].query).toBe('query 14'); // Most recent
      expect(history[9].query).toBe('query 5'); // Oldest kept
    });

    it('should handle localStorage write errors', () => {
      const { result } = renderHook(() => useSearchHistory());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock localStorage.setItem to throw error
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('Storage full');
      });

      act(() => {
        result.current.addToHistory({ query: 'test', filters: {}, timestamp: Date.now() });
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save search history to localStorage',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      const { result } = renderHook(() => useSearchHistory());

      act(() => {
        result.current.addToHistory({ query: 'test 1', filters: {}, timestamp: Date.now() });
      });

      act(() => {
        result.current.addToHistory({ query: 'test 2', filters: {}, timestamp: Date.now() + 1000 });
      });

      expect(result.current.getHistory()).toHaveLength(2);

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.getHistory()).toHaveLength(0);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('should handle localStorage removal errors', () => {
      const { result } = renderHook(() => useSearchHistory());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock localStorage.removeItem to throw error
      const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
      removeItemSpy.mockImplementation(() => {
        throw new Error('Cannot remove');
      });

      act(() => {
        result.current.clearHistory();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear search history',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      removeItemSpy.mockRestore();
    });
  });

  describe('removeFromHistory', () => {
    it('should remove specific item by timestamp', () => {
      const { result } = renderHook(() => useSearchHistory());
      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 1000;

      act(() => {
        result.current.addToHistory({ query: 'test 1', filters: {}, timestamp: timestamp1 });
      });

      act(() => {
        result.current.addToHistory({ query: 'test 2', filters: {}, timestamp: timestamp2 });
      });

      expect(result.current.getHistory()).toHaveLength(2);

      act(() => {
        result.current.removeFromHistory(timestamp1);
      });

      const history = result.current.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].timestamp).toBe(timestamp2);
    });

    it('should update localStorage after removal', () => {
      const { result } = renderHook(() => useSearchHistory());
      const timestamp = Date.now();

      act(() => {
        result.current.addToHistory({ query: 'test', filters: {}, timestamp });
      });

      act(() => {
        result.current.removeFromHistory(timestamp);
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(0);
    });

    it('should handle non-existent timestamp gracefully', () => {
      const { result } = renderHook(() => useSearchHistory());
      const timestamp = Date.now();

      act(() => {
        result.current.addToHistory({ query: 'test', filters: {}, timestamp });
      });

      act(() => {
        result.current.removeFromHistory(999999);
      });

      expect(result.current.getHistory()).toHaveLength(1);
    });

    it('should handle localStorage write errors', () => {
      const { result } = renderHook(() => useSearchHistory());
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const timestamp = Date.now();

      act(() => {
        result.current.addToHistory({ query: 'test', filters: {}, timestamp });
      });

      // Mock localStorage.setItem to throw error
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('Storage full');
      });

      act(() => {
        result.current.removeFromHistory(timestamp);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to remove item from search history',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('getHistory', () => {
    it('should return current history', () => {
      const { result } = renderHook(() => useSearchHistory());
      const items = [
        { query: 'test 1', filters: {}, timestamp: Date.now() },
        { query: 'test 2', filters: {}, timestamp: Date.now() + 1000 },
      ];

      items.forEach(item => {
        act(() => {
          result.current.addToHistory(item);
        });
      });

      const history = result.current.getHistory();
      expect(history).toHaveLength(2);
    });
  });
});
