import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchPage from '@/app/search/page';
import { useSearchParams } from 'next/navigation';

const mockApiClient = {
  search: jest.fn(),
};

jest.mock('@/api/client', () => ({
  getPublicApiClient: jest.fn(() => mockApiClient),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

const mockUseSearchParams = useSearchParams as jest.Mock;

const setSearchParams = (entries: Record<string, string | null>) => {
  mockUseSearchParams.mockReturnValue({
    get: (key: string) => entries[key] ?? null,
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => resolve(value),
  };
};

describe('Public Search Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSearchParams({});
    jest.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    window.scrollTo = jest.fn();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('executes search and renders results', async () => {
    mockApiClient.search.mockResolvedValue({
      results: [
        {
          id: '1',
          title: 'Lambda Deep Dive',
          description: 'Learn about AWS Lambda',
          contentType: 'blog',
          tags: ['lambda'],
          visibility: 'public',
          urls: [{ url: 'https://example.com' }],
        },
      ],
      total: 1,
      offset: 0,
      limit: 10,
    });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'lambda' }));
      expect(screen.getByText('Lambda Deep Dive')).toBeInTheDocument();
    });
  });

  it('prefills search criteria from URL parameters', async () => {
    setSearchParams({
      q: 'containers',
      type: 'blog',
      tags: 'ecs',
      badges: 'hero',
      page: '2',
    });

    mockApiClient.search.mockResolvedValue({
      results: [],
      total: 0,
      offset: 10,
      limit: 10,
    });

    render(<SearchPage />);

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenCalledWith(expect.objectContaining({
        q: 'containers',
        type: 'blog',
        tags: 'ecs',
        badges: 'hero',
        offset: 10,
      }));
      expect(screen.getByDisplayValue('containers')).toBeInTheDocument();
    });
  });

  it('handles pagination and updates query params', async () => {
    mockApiClient.search.mockResolvedValue({
      results: Array.from({ length: 10 }, (_, i) => ({
        id: `id-${i}`,
        title: `Result ${i}`,
        contentType: 'blog',
        visibility: 'public',
        tags: [],
        urls: [{ url: 'https://example.com' }],
      })),
      total: 25,
      offset: 0,
      limit: 10,
    });

    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'lambda' }));
    });

    // Mock second page response
    mockApiClient.search.mockResolvedValue({
      results: [],
      total: 25,
      offset: 10,
      limit: 10,
    });

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10 }));
      expect(replaceStateSpy).toHaveBeenLastCalledWith({}, '', expect.stringContaining('page=2'));
    });
  });

  it('applies filters to search requests', async () => {
    mockApiClient.search.mockResolvedValue({
      results: [],
      total: 0,
      offset: 0,
      limit: 10,
    });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'containers' } });
    const [contentTypeSelect, badgesSelect] = screen.getAllByRole('combobox');
    fireEvent.change(contentTypeSelect, { target: { value: 'github' } });
    fireEvent.change(badgesSelect, { target: { value: 'ambassador' } });
    fireEvent.change(screen.getByPlaceholderText(/e.g., serverless,lambda/i), { target: { value: 'kubernetes,eks' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenCalledWith(expect.objectContaining({
        q: 'containers',
        type: 'github',
        badges: 'ambassador',
        tags: 'kubernetes,eks',
      }));
    });
  });

  it('displays error when search fails', async () => {
    mockApiClient.search.mockRejectedValue(new Error('boom'));

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'error' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to perform search/i)).toBeInTheDocument();
    });
  });

  it('renders empty-state messaging when no results returned', async () => {
    mockApiClient.search.mockResolvedValue({ results: [], total: 0, offset: 0, limit: 10 });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/no results found/i)).toBeInTheDocument();
    });
  });

  it('shows call-to-action for anonymous users after search', async () => {
    mockApiClient.search.mockResolvedValue({
      results: [],
      total: 0,
      offset: 0,
      limit: 10,
    });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/create account/i)).toBeInTheDocument();
    });
  });

  it('hides call-to-action when authenticated', async () => {
    window.localStorage.setItem('accessToken', 'token');
    mockApiClient.search.mockResolvedValue({
      results: [{
        id: '1',
        title: 'Lambda Deep Dive',
        contentType: 'blog',
        visibility: 'public',
        tags: [],
        urls: [{ url: 'https://example.com' }],
      }],
      total: 1,
      offset: 0,
      limit: 10,
    });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
    });
  });

  it('condenses pagination controls for large result sets', async () => {
    const pagingResponse = (offset: number) => ({
      results: Array.from({ length: 10 }, (_, i) => ({
        id: `id-${offset + i}`,
        title: `Result ${offset + i}`,
        contentType: 'blog',
        visibility: 'public',
        tags: [],
        urls: [{ url: 'https://example.com' }],
      })),
      total: 120,
      offset,
      limit: 10,
    });

    mockApiClient.search
      .mockResolvedValueOnce(pagingResponse(0))
      .mockResolvedValueOnce(pagingResponse(40))
      .mockResolvedValueOnce(pagingResponse(110));

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'lambda', offset: 0 }));
      expect(screen.getAllByText('...').length).toBe(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '5' }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 40 }));
      expect(screen.getAllByText('...').length).toBe(2);
    });

    fireEvent.click(screen.getByRole('button', { name: '12' }));

    await waitFor(() => {
      expect(mockApiClient.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 110 }));
      expect(screen.getAllByText('...').length).toBe(1);
    });
  });

  it('shows loading spinner while searches are pending', async () => {
    const deferred = createDeferred<any>();
    mockApiClient.search.mockReturnValue(deferred.promise);

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    const searchingLabels = screen.getAllByText('Searching...');
    expect(searchingLabels.length).toBeGreaterThanOrEqual(2);
    expect(searchingLabels.some((node) => node.tagName === 'P')).toBe(true);

    deferred.resolve({ results: [], total: 0, offset: 0, limit: 10 });

    await waitFor(() => {
      expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
    });
  });

  it('filters out non-public results before rendering', async () => {
    mockApiClient.search.mockResolvedValue({
      results: [
        {
          id: '1',
          title: 'Public Blog',
          contentType: 'blog',
          visibility: 'public',
          tags: [],
          urls: [{ url: 'https://example.com/public' }],
        },
        {
          id: '2',
          title: 'Internal Paper',
          contentType: 'whitepaper',
          visibility: 'aws_only',
          tags: [],
          urls: [{ url: 'https://example.com/internal' }],
        },
      ],
      total: 2,
      offset: 0,
      limit: 10,
    });

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/search aws content/i), { target: { value: 'lambda' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText('Public Blog')).toBeInTheDocument();
      expect(screen.queryByText('Internal Paper')).toBeNull();
    });
  });
});
