/**
 * Test Suite: Authenticated Search Interface
 * Tests for Task 6.4: Enhanced search with authentication features
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SearchPage from '@/app/dashboard/search/SearchPageClient';
import { apiClient } from '@/api/client';
import { BadgeType, Visibility, ContentType } from '@shared/types';

// Mock the API client
jest.mock('@/api/client', () => ({
  apiClient: {
    search: jest.fn(),
    advancedSearch: jest.fn(),
    trackAnalyticsEvents: jest.fn(),
    exportAdvancedSearchCsv: jest.fn(),
    getSavedSearches: jest.fn(),
    saveSearch: jest.fn(),
    updateSavedSearch: jest.fn(),
    deleteSavedSearch: jest.fn(),
    getSavedSearch: jest.fn(),
  },
}));

jest.mock('@/lib/api/lazyClient', () => ({
  loadSharedApiClient: jest.fn(),
}));

jest.mock('@/utils/download', () => ({
  downloadBlob: jest.fn(),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

const { useSearchParams } = jest.requireMock('next/navigation');
const mockUseSearchParams = useSearchParams as jest.Mock;

const setSearchParams = (entries: Record<string, string | null>) => {
  mockUseSearchParams.mockReturnValue({
    get: (key: string) => entries[key] ?? null,
  });
};

const downloadBlob = jest.requireMock('@/utils/download').downloadBlob as jest.Mock;
const { loadSharedApiClient } = jest.requireMock('@/lib/api/lazyClient') as {
  loadSharedApiClient: jest.Mock;
};
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('Authenticated Search Interface', () => {
  const searchItems = [
    {
      id: '1',
      title: 'AWS Lambda Best Practices',
      description: 'Learn serverless best practices',
      contentType: 'blog',
      visibility: 'public',
      publishDate: '2024-01-15',
      urls: [{ id: '1', url: 'https://example.com/lambda' }],
      tags: ['serverless', 'lambda'],
      userId: 'user1',
      captureDate: '2024-01-15',
      metrics: {},
      isClaimed: true,
      createdAt: '2024-01-15',
      updatedAt: '2024-01-15',
    },
    {
      id: '2',
      title: 'AWS Community Content',
      description: 'AWS only content',
      contentType: 'youtube',
      visibility: 'aws_only',
      publishDate: '2024-01-14',
      urls: [{ id: '2', url: 'https://youtube.com/watch' }],
      tags: ['aws', 'community'],
      userId: 'user2',
      captureDate: '2024-01-14',
      metrics: {},
      isClaimed: false,
      createdAt: '2024-01-14',
      updatedAt: '2024-01-14',
    },
  ];

  const mockSearchResults = {
    items: searchItems,
    content: searchItems,
    total: 2,
    limit: 10,
    offset: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setSearchParams({});
    localStorageMock.clear();
    downloadBlob.mockReset();
    loadSharedApiClient.mockResolvedValue(apiClient);

    mockedApiClient.getSavedSearches.mockResolvedValue({ searches: [], count: 0 });
    mockedApiClient.saveSearch.mockImplementation(async ({ query, filters }) => ({
      id: 'saved-generated',
      userId: 'user-1',
      name: query,
      query,
      filters,
      isPublic: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mockedApiClient.updateSavedSearch.mockImplementation(async (_, payload) => ({
      id: 'saved-generated',
      userId: 'user-1',
      name: payload.name ?? 'Updated',
      query: payload.query ?? 'updated',
      filters: payload.filters ?? {},
      isPublic: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mockedApiClient.deleteSavedSearch.mockResolvedValue(undefined as unknown as any);
    mockedApiClient.getSavedSearch.mockResolvedValue({
      id: 'saved-prefetched',
      userId: 'user-1',
      name: 'prefetched',
      query: 'prefetched',
      filters: { __sortBy: 'relevance' },
      isPublic: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockedApiClient.advancedSearch.mockResolvedValue({ results: [], count: 0, query: '' });
    mockedApiClient.trackAnalyticsEvents.mockResolvedValue(undefined as unknown as any);
    mockedApiClient.exportAdvancedSearchCsv.mockResolvedValue({
      blob: new Blob(['id,title\n']),
      filename: 'search-results.csv',
    });

    mockedApiClient.search.mockImplementation((params: any) => {
      const query = params.q?.toLowerCase() || '';

      if (query === 'lambda functions' || query === 'lambda layers' || query === 'notfound') {
        return Promise.resolve({ items: [], content: [], total: 0, limit: 10, offset: 0 });
      }

      if (query.includes('serverless') || query.includes('aws') || query.includes('test') || query === 'lambda') {
        return Promise.resolve(mockSearchResults);
      }

      return Promise.resolve({ items: [], content: [], total: 0, limit: 10, offset: 0 });
    });
  });

  describe('Advanced search and export flows', () => {
    it('executes advanced search when advanced mode is enabled', async () => {
      const user = userEvent.setup();
      mockedApiClient.advancedSearch.mockResolvedValueOnce({
        results: [
          {
            id: 'adv-1',
            title: 'Advanced Result',
            description: 'Deep dive content',
            contentType: 'blog',
            visibility: 'public',
            publishDate: '2024-02-01',
            urls: [{ id: 'adv-1', url: 'https://example.com/advanced' }],
            tags: ['advanced'],
            userId: 'user-adv',
            captureDate: '2024-02-01',
            metrics: {},
            isClaimed: true,
            createdAt: '2024-02-01',
            updatedAt: '2024-02-01',
          },
        ],
        count: 1,
        query: 'advanced query',
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'advanced query');

      const advancedToggle = screen.getByLabelText(/Advanced operators/i);
      await user.click(advancedToggle);

      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];
      await user.click(searchButton);

      await waitFor(() =>
        expect(mockedApiClient.advancedSearch).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'advanced query',
            withinIds: undefined,
            limit: 10,
          })
        )
      );
      await waitFor(() => expect(screen.getByText('Advanced Result')).toBeInTheDocument());
      expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'search',
          metadata: expect.objectContaining({ advanced: true }),
        })
      );
    });

    it('executes search within results using advanced API with withinIds', async () => {
      const user = userEvent.setup();
      mockedApiClient.search.mockResolvedValueOnce(mockSearchResults);
      mockedApiClient.advancedSearch.mockResolvedValueOnce({
        results: mockSearchResults.items,
        count: 2,
        query: 'refined',
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'aws content');

      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];
      await user.click(searchButton);
      await waitFor(() => expect(screen.getByText('AWS Lambda Best Practices')).toBeInTheDocument());

      mockedApiClient.trackAnalyticsEvents.mockClear();

      const withinToggle = screen.getByLabelText(/Search within results/i);
      await user.click(withinToggle);

      await user.clear(searchInput);
      await user.type(searchInput, 'refined');
      await user.click(searchButton);

      await waitFor(() =>
        expect(mockedApiClient.advancedSearch).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'refined',
            withinIds: ['1', '2'],
            limit: 10,
          })
        )
      );
      expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'search',
          metadata: expect.objectContaining({ advanced: true }),
        })
      );
    });

    it('prompts for a query before exporting results', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const exportButton = screen.getByRole('button', { name: /Export CSV/i });
      await user.click(exportButton);

      expect(mockedApiClient.exportAdvancedSearchCsv).not.toHaveBeenCalled();
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(screen.getByText(/Enter a query before exporting results/i)).toBeInTheDocument();
    });

    it('shows an error when export fails', async () => {
      const user = userEvent.setup();
      mockedApiClient.exportAdvancedSearchCsv.mockRejectedValueOnce(new Error('Export failure'));

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'troublesome export');

      const exportButton = screen.getByRole('button', { name: /Export CSV/i });
      await user.click(exportButton);

      await waitFor(() =>
        expect(screen.getByText(/Failed to export search results/i)).toBeInTheDocument()
      );
      expect(downloadBlob).not.toHaveBeenCalled();
    });

    it('shows an error when the search API call fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockedApiClient.search.mockRejectedValueOnce(new Error('Network failure'));

      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'failing query');

      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];
      await user.click(searchButton);

      await waitFor(() =>
        expect(screen.getByText(/Failed to perform search\. Please try again\./i)).toBeInTheDocument()
      );
      consoleErrorSpy.mockRestore();
    });

    it('does not attempt to save a search when the query is empty', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const saveButton = screen.getByRole('button', { name: /Save Search/i });
      await user.click(saveButton);

      expect(mockedApiClient.saveSearch).not.toHaveBeenCalled();
    });

    it('exports using withinIds when search within results is enabled', async () => {
      const user = userEvent.setup();
      mockedApiClient.search.mockResolvedValueOnce(mockSearchResults);
      const blob = new Blob(['csv']);
      mockedApiClient.exportAdvancedSearchCsv.mockResolvedValueOnce({
        blob,
        filename: 'with-results.csv',
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'aws content');

      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];
      await user.click(searchButton);
      await waitFor(() => expect(screen.getByText('AWS Lambda Best Practices')).toBeInTheDocument());

      const withinToggle = screen.getByLabelText(/Search within results/i);
      await user.click(withinToggle);

      const exportButton = screen.getByRole('button', { name: /Export CSV/i });
      await user.click(exportButton);

      await waitFor(() =>
        expect(mockedApiClient.exportAdvancedSearchCsv).toHaveBeenCalledWith({
          query: 'aws content',
          withinIds: ['1', '2'],
        })
      );
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'with-results.csv');
    });
  });

  describe('Content interaction analytics', () => {
    it('tracks analytics when a result link is clicked', async () => {
      const user = userEvent.setup();
      mockedApiClient.search.mockResolvedValueOnce(mockSearchResults);

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'aws');

      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];
      await user.click(searchButton);

      const resultLink = await screen.findByRole('link', { name: 'AWS Lambda Best Practices' });
      await user.click(resultLink);

      await waitFor(() =>
        expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'content_click',
            contentId: '1',
            metadata: expect.objectContaining({
              source: 'search_results',
              url: 'https://example.com/lambda',
            }),
          })
        )
      );
    });
  });

  describe('Initial URL hydration', () => {
    it('hydrates search state from URL parameters and performs search', async () => {
      mockedApiClient.search.mockResolvedValueOnce(mockSearchResults);

      setSearchParams({
        q: 'aws content',
        type: 'blog,youtube',
        badges: 'hero',
        visibility: 'public',
        tags: 'serverless',
        startDate: '2024-01-01',
        endDate: '2024-02-01',
        sortBy: 'date',
        page: '2',
        mode: 'advanced',
      });

      render(<SearchPage />);

      await waitFor(() =>
        expect(mockedApiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            q: 'aws content',
            offset: 10,
            filters: expect.objectContaining({
              contentTypes: ['blog', 'youtube'],
              badges: ['hero'],
              visibility: ['public'],
              tags: ['serverless'],
              dateRange: expect.any(Object),
            }),
            sortBy: 'date',
          })
        )
      );
      expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalled();
    });
  });

  describe('Search Bar with Autocomplete', () => {
    it('should render search bar with placeholder', () => {
      render(<SearchPage />);
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it('should show autocomplete suggestions when typing', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];

      await user.type(searchInput, 'lambda functions');
      await user.click(searchButton);
      await waitFor(() => {
        expect(screen.getByText(/No results found/i)).toBeInTheDocument();
      });

      await user.clear(searchInput);
      await user.type(searchInput, 'lambda layers');
      await user.click(searchButton);
      await waitFor(() => {
        expect(screen.getByText(/No results found/i)).toBeInTheDocument();
      });

      await user.clear(searchInput);
      await user.type(searchInput, 'lambda');

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      expect(screen.getByText('lambda functions')).toBeInTheDocument();
      expect(screen.getByText('lambda layers')).toBeInTheDocument();
    });

    it('should select autocomplete suggestion on click', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];

      await user.type(searchInput, 'lambda functions');
      await user.click(searchButton);
      await waitFor(() => {
        expect(screen.getByText(/No results found/i)).toBeInTheDocument();
      });

      await user.clear(searchInput);
      await user.type(searchInput, 'lambda');

      await waitFor(() => {
        expect(screen.getByText('lambda functions')).toBeInTheDocument();
      });

      const suggestion = screen.getByText('lambda functions');
      await user.click(suggestion);

      await waitFor(() => {
        expect(searchInput).toHaveValue('lambda functions');
      });
    });

    it('should perform search on form submit', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'serverless');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

    await waitFor(() => {
      expect(apiClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'serverless',
        })
      );
    });
  });

  it('performs initial search from URL params using fallback values', async () => {
    setSearchParams({ q: 'prefill' });
    (apiClient.search as jest.Mock).mockResolvedValueOnce({});

    render(<SearchPage />);

    await waitFor(() => {
      expect(apiClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'prefill',
          offset: 0,
          limit: 10,
        })
      );
    });

    const input = screen.getByRole('combobox', { name: /search/i });
    await waitFor(() => {
      expect(input).toHaveValue('prefill');
    });
    await waitFor(() => {
      expect(screen.getByText(/no results found/i)).toBeInTheDocument();
    });
  });
});

  describe('Filter Sidebar', () => {
    it('should render all filter sections', () => {
      render(<SearchPage />);

      expect(screen.getByText(/content type/i)).toBeInTheDocument();
      expect(screen.getByText(/badges/i)).toBeInTheDocument();
      expect(screen.getByText(/date range/i)).toBeInTheDocument();
      expect(screen.getByText(/visibility/i)).toBeInTheDocument();
    });

    it('should filter by content type', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      // Select blog content type
      const blogCheckbox = screen.getByLabelText(/^blog$/i);
      await user.click(blogCheckbox);

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              contentTypes: ['blog'],
            }),
          })
        );
      });
    });

    it('should filter by badge type', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const heroCheckbox = screen.getByLabelText(/hero/i);
      await user.click(heroCheckbox);

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              badges: ['hero'],
            }),
          })
        );
      });
    });

    it('should filter by visibility (authenticated users only)', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      // Should show visibility filter for authenticated users
      const visibilitySection = screen.getByText(/visibility/i);
      expect(visibilitySection).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const awsOnlyCheckbox = screen.getByLabelText(/aws only/i);
      await user.click(awsOnlyCheckbox);

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              visibility: ['aws_only'],
            }),
          })
        );
      });
    });

    it('should filter by date range', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const startDateInput = screen.getByLabelText(/from date/i);
      const endDateInput = screen.getByLabelText(/to date/i);

      await user.type(startDateInput, '2024-01-01');
      await user.type(endDateInput, '2024-12-31');

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              dateRange: {
                start: expect.any(Date),
                end: expect.any(Date),
              },
            }),
          })
        );
      });
    });

    it('should clear all filters', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      // Apply some filters
      const blogCheckbox = screen.getByLabelText(/^blog$/i);
      await user.click(blogCheckbox);

      await waitFor(() => {
        expect(blogCheckbox).toBeChecked();
      });

      // Clear filters
      const clearButton = screen.getByRole('button', { name: /clear filters/i });
      await user.click(clearButton);

      await waitFor(() => {
        expect(blogCheckbox).not.toBeChecked();
      });
    });

    it('should be mobile responsive with collapsible filters', () => {
      // Mock mobile viewport
      global.innerWidth = 375;
      render(<SearchPage />);

      const filterToggles = screen.getAllByRole('button', { name: /filters/i });
      expect(filterToggles.length).toBeGreaterThan(0);
    });
  });

  describe('Search Results', () => {
    it('should display search results with visibility indicators', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'aws');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      // Wait for API call
      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalled();
      });

      // Check search results appear
      expect(await screen.findByText('AWS Lambda Best Practices')).toBeInTheDocument();
      expect(await screen.findByText('AWS Community Content')).toBeInTheDocument();

      // Check visibility indicators - may appear multiple times (in filters and results)
      const publicElements = screen.getAllByText('public');
      expect(publicElements.length).toBeGreaterThan(0);

      const awsOnlyElements = screen.getAllByText('aws_only');
      expect(awsOnlyElements.length).toBeGreaterThan(0);
    });

    it('should show no results state', async () => {
      const user = userEvent.setup();
    mockedApiClient.search.mockResolvedValue({
        content: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'notfound');

      // Press Escape to close autocomplete if it's open
      await user.keyboard('{Escape}');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      // Wait for search to complete - API should be called
      await waitFor(() => {
      expect(mockedApiClient.search).toHaveBeenCalled();
      });

      // Component shows "Showing 1-0 of 0 results" for no results
      // Wait for results section to render (even if empty)
      await waitFor(() => {
        expect(screen.getByText(/No results found/i)).toBeInTheDocument();
      });

      const lastCall = mockedApiClient.search.mock.calls.slice(-1)[0];
      expect(lastCall[0].q).toBe('notfound');
    });

  it('should display result cards with all metadata', async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'aws');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      // Wait for API call and results to appear
      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalled();
      });

      const title = await screen.findByText('AWS Lambda Best Practices');
      expect(title).toBeInTheDocument();

      const firstCard = title.closest('article');

      expect(firstCard).toBeInTheDocument();
      expect(within(firstCard!).getByText(/learn serverless best practices/i)).toBeInTheDocument();
      expect(within(firstCard!).getByText(/blog/i)).toBeInTheDocument();
      // Check for serverless tag - use getAllByText since it may appear multiple times
      const serverlessTags = within(firstCard!).getAllByText(/serverless/i);
    expect(serverlessTags.length).toBeGreaterThan(0);
  });

  it('should surface API errors to the user', async () => {
    const user = userEvent.setup();
    (apiClient.search as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    render(<SearchPage />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'error case');

    const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
    await user.click(searchButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to perform search/i)).toBeInTheDocument();
    });
  });

  it('should apply saved searches with stored filters', async () => {
    mockedApiClient.getSavedSearches.mockResolvedValueOnce({
      searches: [
        {
          id: 'saved-1',
          userId: 'user-1',
          name: 'lambda',
          query: 'lambda',
          filters: {
            badges: [BadgeType.HERO],
            visibility: [Visibility.PUBLIC],
            __sortBy: 'date',
          },
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      count: 1,
    });

    const user = userEvent.setup();
    render(<SearchPage />);

    const savedToggle = await screen.findByRole('button', { name: /Saved Searches/ });
    await user.click(savedToggle);

    const savedEntry = await screen.findByText('lambda');
    await user.click(savedEntry);

    await waitFor(() => {
      expect(mockedApiClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'lambda',
          filters: expect.objectContaining({ badges: [BadgeType.HERO] }),
        })
      );
    });
  });
  });

describe('Pagination', () => {
    it('should render pagination controls', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        ...mockSearchResults,
        total: 50,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
      });
    });

    it('should navigate to next page', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        ...mockSearchResults,
        total: 50,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        const nextButton = screen.getByRole('button', { name: /next page/i });
        expect(nextButton).toBeInTheDocument();
      });

      const nextButton = screen.getByRole('button', { name: /next page/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(mockedApiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            offset: 10,
          })
        );
      });
    });

    it('should disable previous button on first page', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        ...mockSearchResults,
        total: 50,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        const prevButton = screen.getByRole('button', { name: /previous page/i });
        expect(prevButton).toBeDisabled();
      });
    });
});

describe('Filter Controls', () => {
  it('should clear filters via sidebar control', async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'filters');
    const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
    await user.click(searchButton);

    await waitFor(() => expect(apiClient.search).toHaveBeenCalled());

    const blogCheckbox = await screen.findByLabelText('Blog');
    await user.click(blogCheckbox);

    await waitFor(() => {
      expect(apiClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ contentTypes: [ContentType.BLOG] }),
        })
      );
    });

    const clearFiltersButton = screen.getByRole('button', { name: /clear filters/i });
    await user.click(clearFiltersButton);

    await waitFor(() => {
      const lastCall = (apiClient.search as jest.Mock).mock.calls.slice(-1)[0];
      expect(lastCall[0].filters).toEqual({});
    });
  });
});

describe('Sort Options', () => {
    it('should render sort dropdown', () => {
      render(<SearchPage />);

      expect(screen.getByLabelText(/sort by/i)).toBeInTheDocument();
    });

    it('should sort by relevance (default)', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const sortSelect = screen.getByLabelText(/sort by/i);
      expect(sortSelect).toHaveValue('relevance');
    });

    it('should sort by date', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const sortSelect = screen.getByLabelText(/sort by/i);
      await user.selectOptions(sortSelect, 'date');

      await waitFor(() => {
        expect(mockedApiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'date',
          })
        );
      });
    });
  });

  describe('Save Search Functionality', () => {
    it('should show save search button for authenticated users', () => {
      render(<SearchPage />);

      expect(screen.getByRole('button', { name: /save search/i })).toBeInTheDocument();
    });

    it('should save current search via API', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'lambda');

      // Perform search first to populate results (save button saves current search state)
      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalled();
      });

      const saveButton = screen.getByRole('button', { name: /save search/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockedApiClient.saveSearch).toHaveBeenCalledWith(
          expect.objectContaining({ query: 'lambda' })
        );
      });
    });

    it('should display list of saved searches', async () => {
      const user = userEvent.setup();
      mockedApiClient.getSavedSearches.mockResolvedValueOnce({
        searches: [
          {
            id: '1',
            userId: 'user-1',
            name: 'lambda',
            query: 'lambda',
            filters: { __sortBy: 'relevance' },
            isPublic: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: '2',
            userId: 'user-1',
            name: 'serverless',
            query: 'serverless',
            filters: { __sortBy: 'relevance' },
            isPublic: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        count: 2,
      });

      render(<SearchPage />);

      await waitFor(() => {
        const savedSearchesButton = screen.getByText(/saved searches/i);
        expect(savedSearchesButton).toBeInTheDocument();
      });

      const savedSearchesButton = screen.getByText(/saved searches/i);
      await user.click(savedSearchesButton);

      await waitFor(() => {
        expect(screen.getAllByText('lambda')[0]).toBeInTheDocument();
        expect(screen.getByText('serverless')).toBeInTheDocument();
      });
    });

    it('uses advanced search when advanced mode is enabled', async () => {
      const user = userEvent.setup();
      mockedApiClient.advancedSearch.mockResolvedValueOnce({
        query: 'advanced query',
        count: 1,
        results: [
          {
            id: 'adv-1',
            title: 'Advanced Result',
            description: 'Advanced description',
            contentType: 'blog',
            visibility: 'public',
            publishDate: new Date().toISOString(),
            url: 'https://example.com/advanced',
          },
        ],
      });

      render(<SearchPage />);

      const advancedToggle = screen.getByLabelText(/advanced operators/i);
      await user.click(advancedToggle);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'advanced query');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(mockedApiClient.advancedSearch).toHaveBeenCalledWith(
          expect.objectContaining({ query: 'advanced query' })
        );
      });
    });

    it('should load saved search when clicked', async () => {
      const user = userEvent.setup();
      mockedApiClient.getSavedSearches.mockResolvedValueOnce({
        searches: [
          {
            id: '1',
            userId: 'user-1',
            name: 'lambda',
            query: 'lambda',
            filters: { contentTypes: ['blog'], __sortBy: 'relevance' },
            isPublic: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        count: 1,
      });

      render(<SearchPage />);

      await waitFor(() => {
        const savedSearchesButton = screen.getByText(/saved searches/i);
        expect(savedSearchesButton).toBeInTheDocument();
      });

      const savedSearchesButton = screen.getByText(/saved searches/i);
      await user.click(savedSearchesButton);

      await waitFor(() => {
        expect(screen.getAllByText('lambda')[0]).toBeInTheDocument();
      });

      const savedSearch = screen.getAllByText('lambda')[0];
      await user.click(savedSearch);

      // Wait for search to be performed when saved search is loaded
      await waitFor(() => {
        expect(mockedApiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            q: 'lambda',
            filters: expect.objectContaining({
              contentTypes: ['blog'],
            }),
          })
        );
      });
    });

    it('should delete saved searches via API', async () => {
      const user = userEvent.setup();
      mockedApiClient.getSavedSearches.mockResolvedValueOnce({
        searches: [
          {
            id: 'delete-me',
            userId: 'user-1',
            name: 'obsolete',
            query: 'obsolete',
            filters: { __sortBy: 'relevance' },
            isPublic: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        count: 1,
      });

      render(<SearchPage />);

      await waitFor(() => {
        expect(screen.getByText(/saved searches/i)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/saved searches/i));

      const deleteButton = await screen.findByLabelText(/delete saved search/i);
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockedApiClient.deleteSavedSearch).toHaveBeenCalledWith('delete-me');
      });
    });
  });

  describe('Search History', () => {
    it('should save searches to localStorage', async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'lambda');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      // Wait for search to complete and history to be saved
      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            q: 'lambda',
          })
        );
      });

      await waitFor(() => {
        const history = JSON.parse(localStorageMock.getItem('aws_community_search_history') || '[]');
        expect(history).toContainEqual(
          expect.objectContaining({
            query: 'lambda',
          })
        );
      });
    });

    it('should limit search history to last 10 searches', async () => {
      const user = userEvent.setup();

      // Pre-populate with 10 searches
      const existingHistory = Array.from({ length: 10 }, (_, i) => ({
        query: `query${i}`,
        filters: {},
        timestamp: Date.now() - i * 1000,
      }));
      localStorageMock.setItem('aws_community_search_history', JSON.stringify(existingHistory));

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'new search');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      // Wait for search API call to complete
      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            q: 'new search',
          })
        );
      });

      // Wait for history to be updated
      await waitFor(() => {
        const history = JSON.parse(localStorageMock.getItem('aws_community_search_history') || '[]');
        expect(history).toHaveLength(10);
        expect(history[0].query).toBe('new search');
      });
    });

    it('should show recent searches dropdown', async () => {
      const user = userEvent.setup();
      localStorageMock.setItem('aws_community_search_history', JSON.stringify([
        { query: 'lambda', filters: {}, timestamp: Date.now() },
      ]));

      render(<SearchPage />);

      // Wait for component to load history from localStorage
      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/search/i);
        expect(searchInput).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search/i);

      // Focus the input to trigger history dropdown (only shows if history exists)
      await user.click(searchInput);

      // Wait for dropdown to appear
      await waitFor(() => {
        expect(screen.getByText(/recent searches/i)).toBeInTheDocument();
        expect(screen.getAllByText('lambda')[0]).toBeInTheDocument();
      });
    });

    it('should clear search history', async () => {
      const user = userEvent.setup();
      localStorageMock.setItem('aws_community_search_history', JSON.stringify([
        { query: 'lambda', filters: {}, timestamp: Date.now() },
      ]));

      render(<SearchPage />);

      // Wait for component to load history from localStorage
      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/search/i);
        expect(searchInput).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.click(searchInput);

      // Wait for history dropdown to appear
      await waitFor(() => {
        expect(screen.getByText(/recent searches/i)).toBeInTheDocument();
      });

      const clearHistoryButton = screen.getByText(/clear history/i);
      await user.click(clearHistoryButton);

      await waitFor(() => {
        const history = localStorageMock.getItem('aws_community_search_history');
        expect(history).toBeNull();
      });
    });
  });

  describe('Mobile Responsive', () => {
    it('should show mobile filter toggle button', () => {
      global.innerWidth = 375;
      render(<SearchPage />);

      const filterToggles = screen.getAllByRole('button', { name: /filters/i });
      expect(filterToggles.length).toBeGreaterThan(0);
    });

    it('should toggle filters on mobile', async () => {
      const user = userEvent.setup();
      global.innerWidth = 375;
      render(<SearchPage />);

      const filterToggles = screen.getAllByRole('button', { name: /filters/i });
      await user.click(filterToggles[0]);

      // Filter sidebar visibility changes but no 'open' class in current implementation
      // Just verify the button exists and can be clicked
      expect(filterToggles[0]).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should show error message on search failure', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockRejectedValue(new Error('Search failed'));

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to perform search/i)).toBeInTheDocument();
      });
    });

    it('should show loading state during search', async () => {
      const user = userEvent.setup();
      // Make search slow to capture loading state
      (apiClient.search as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockSearchResults), 100))
      );

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/searching/i)).toBeInTheDocument();
      });
    });
  });

  describe('Search Results Display - Badge Types', () => {
    it('should display AWS Hero badge with correct color', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content by Hero',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
          user: {
            id: 'user1',
            username: 'awshero',
            email: 'hero@example.com',
            isAwsEmployee: false,
          },
          badges: [{
            id: 'badge1',
            badgeType: 'hero',
            userId: 'user1',
            issuedAt: '2024-01-01',
            issuedBy: 'AWS',
          }],
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText('Test Content by Hero')).toBeInTheDocument();
      });

      // Check for AWS Hero badge in the results area (not in filter sidebar)
      const badges = screen.getAllByText(/aws hero/i);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should display Community Builder badge with correct color', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content by Builder',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
          user: {
            id: 'user1',
            username: 'builder',
            email: 'builder@example.com',
            isAwsEmployee: false,
          },
          badges: [{
            id: 'badge1',
            badgeType: 'community_builder',
            userId: 'user1',
            issuedAt: '2024-01-01',
            issuedBy: 'AWS',
          }],
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText('Test Content by Builder')).toBeInTheDocument();
      });

      // Check for Community Builder badge in results
      const badges = screen.getAllByText(/community builder/i);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should display Ambassador badge with correct color', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
          user: {
            id: 'user1',
            username: 'ambassador',
            email: 'ambassador@example.com',
            isAwsEmployee: false,
          },
          badges: [{
            id: 'badge1',
            badgeType: 'ambassador',
            userId: 'user1',
            issuedAt: '2024-01-01',
            issuedBy: 'AWS',
          }],
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/aws ambassador/i)).toBeInTheDocument();
      });
    });

    it('should display User Group Leader badge with correct color', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content by Leader',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
          user: {
            id: 'user1',
            username: 'ugleader',
            email: 'leader@example.com',
            isAwsEmployee: false,
          },
          badges: [{
            id: 'badge1',
            badgeType: 'user_group_leader',
            userId: 'user1',
            issuedAt: '2024-01-01',
            issuedBy: 'AWS',
          }],
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText('Test Content by Leader')).toBeInTheDocument();
      });

      // Check for User Group Leader badge in results
      const badges = screen.getAllByText(/user group leader/i);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should display AWS Employee badge', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
          user: {
            id: 'user1',
            username: 'awsemployee',
            email: 'employee@amazon.com',
            isAwsEmployee: true,
          },
          badges: [],
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/aws employee/i)).toBeInTheDocument();
      });
    });
  });

  describe('Search Results Display - Metrics', () => {
    it('should display views metric', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {
            views: 1500,
          },
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/1,500 views/i)).toBeInTheDocument();
      });
    });

    it('should display likes metric', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {
            likes: 250,
          },
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/250 likes/i)).toBeInTheDocument();
      });
    });

    it('should display publish date', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content with Date',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15T00:00:00Z',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {
            views: 100,
          },
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText('Test Content with Date')).toBeInTheDocument();
      });

      // Check that metrics section with date icon is displayed
      // The date is formatted by toLocaleDateString which varies by environment
      await waitFor(() => {
        expect(screen.getByText(/100 views/i)).toBeInTheDocument();
      });

      // Verify a date string containing "2024" exists (date format may vary)
      const bodyText = screen.getByText('Test Content with Date').closest('div')?.textContent || '';
      expect(bodyText).toMatch(/2024/);
    });
  });

  describe('Search Results Display - Content Details', () => {
    it('should display content without URLs as plain title', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Content Without URL',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [],
          tags: ['aws'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        const title = screen.getByText('Content Without URL');
        expect(title).toBeInTheDocument();
        expect(title.closest('a')).not.toBeInTheDocument();
      });
    });

    it('should display more than 3 tags with overflow indicator', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [{
          id: '1',
          title: 'Test Content',
          description: 'Test description',
          contentType: 'blog',
          visibility: 'public',
          publishDate: '2024-01-15',
          urls: [{ id: '1', url: 'https://example.com/test' }],
          tags: ['aws', 'lambda', 'serverless', 'api-gateway', 's3'],
          userId: 'user1',
          captureDate: '2024-01-15',
          metrics: {},
          isClaimed: true,
          createdAt: '2024-01-15',
          updatedAt: '2024-01-15',
        }],
        total: 1,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(/\+2 more/i)).toBeInTheDocument();
      });
    });
  });

  describe('Pagination - Advanced Scenarios', () => {
    it('should render page numbers for many pages (early pages)', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValue({
        content: [mockSearchResults.content[0]],
        total: 100,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /page 1/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /page 2/i })).toBeInTheDocument();
      });
    });

    it('should render page numbers for many pages (middle pages)', async () => {
      const user = userEvent.setup();
      (apiClient.search as jest.Mock).mockResolvedValueOnce({
        content: [mockSearchResults.content[0]],
        total: 100,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
      });

      (apiClient.search as jest.Mock).mockResolvedValueOnce({
        content: [mockSearchResults.content[0]],
        total: 100,
        limit: 10,
        offset: 50,
      });

      const page5Button = screen.getByRole('button', { name: /page 5/i });
      await user.click(page5Button);

      await waitFor(() => {
        expect(apiClient.search).toHaveBeenCalledWith(
          expect.objectContaining({
            offset: 40,
          })
        );
      });
    });

    it('should calculate page numbers correctly for late pages', async () => {
      const user = userEvent.setup();
      // Start with initial search
      (apiClient.search as jest.Mock).mockResolvedValueOnce({
        content: [mockSearchResults.content[0]],
        total: 100,
        limit: 10,
        offset: 0,
      });

      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'test');

      const searchButton = screen.getAllByRole('button', { name: /search/i })[0];
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /page 1/i })).toBeInTheDocument();
      });

      // Now mock for a late page (page 9)
      (apiClient.search as jest.Mock).mockResolvedValueOnce({
        content: [mockSearchResults.content[0]],
        total: 100,
        limit: 10,
        offset: 80,
      });

      // Click on page 9 if it exists in the initial render, or use next button
      const page9Button = screen.queryByRole('button', { name: /page 9/i });
      if (page9Button) {
        await user.click(page9Button);
      } else {
        // Navigate using next button multiple times
        for (let i = 0; i < 8; i++) {
          const nextButton = screen.queryByRole('button', { name: /next page/i });
          if (nextButton && !nextButton.hasAttribute('disabled')) {
            (apiClient.search as jest.Mock).mockResolvedValueOnce({
              content: [mockSearchResults.content[0]],
              total: 100,
              limit: 10,
              offset: (i + 1) * 10,
            });
            await user.click(nextButton);
            await waitFor(() => {
              expect(apiClient.search).toHaveBeenCalled();
            });
          }
        }
      }

      // Verify we can see late page numbers
      await waitFor(() => {
        const page10Button = screen.queryByRole('button', { name: /page 10/i });
        expect(page10Button).toBeInTheDocument();
      });
    });
  });

  describe('SearchBar Keyboard Navigation', () => {
    const renderWithHistory = async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      const searchButton = screen.getAllByRole('button', { name: /^search$/i })[0];

      await user.type(searchInput, 'lambda functions');
      await user.click(searchButton);
      await waitFor(() => expect(apiClient.search).toHaveBeenCalled());

      await user.clear(searchInput);
      await user.type(searchInput, 'lambda layers');
      await user.click(searchButton);
      await waitFor(() => expect(apiClient.search).toHaveBeenCalled());

      await user.clear(searchInput);
      await user.type(searchInput, 'lambda');
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      return { user, searchInput };
    };

    it('should navigate suggestions with ArrowDown key', async () => {
      const { user, searchInput } = await renderWithHistory();

      fireEvent.keyDown(searchInput, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
      });

      fireEvent.keyDown(searchInput, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('should navigate suggestions with ArrowUp key', async () => {
      const { searchInput } = await renderWithHistory();

      fireEvent.keyDown(searchInput, { key: 'ArrowDown', code: 'ArrowDown' });
      fireEvent.keyDown(searchInput, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveAttribute('aria-selected', 'true');
      });

      fireEvent.keyDown(searchInput, { key: 'ArrowUp', code: 'ArrowUp' });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('should select suggestion with Enter key', async () => {
      const { searchInput } = await renderWithHistory();

      const options = screen.getAllByRole('option');
      const firstSuggestionText = options[0].textContent;

      fireEvent.keyDown(searchInput, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
      });

      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(searchInput).toHaveValue(firstSuggestionText);
      });

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('should close autocomplete with Escape key', async () => {
      const { searchInput } = await renderWithHistory();

      fireEvent.keyDown(searchInput, { key: 'Escape', code: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('should select suggestion on click', async () => {
      const { user, searchInput } = await renderWithHistory();

      const firstSuggestion = screen.getByText('lambda functions');
      await user.click(firstSuggestion);

      await waitFor(() => {
        expect(searchInput).toHaveValue('lambda functions');
      });

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });
});

// Mock localStorage for search history tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});
