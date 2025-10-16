/**
 * Tests for Content Claiming Interface
 * Task 6.7: Content Claiming Interface - TDD
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the API client before importing the page
const mockGetUnclaimedContent = jest.fn();
const mockClaimContent = jest.fn();
const mockBulkClaimContent = jest.fn();

jest.mock('../../../../../src/frontend/src/api/client', () => ({
  apiClient: {
    getUnclaimedContent: mockGetUnclaimedContent,
    claimContent: mockClaimContent,
    bulkClaimContent: mockBulkClaimContent,
  },
}));

import ClaimContentPage from '../../../../../src/frontend/app/dashboard/claim-content/page';

describe('ClaimContentPage', () => {
  const mockUnclaimedContent = [
    {
      id: 'content-1',
      userId: 'system',
      title: 'Getting Started with AWS Lambda',
      description: 'A comprehensive guide to serverless functions',
      contentType: 'blog' as const,
      visibility: 'public' as const,
      publishDate: new Date('2024-01-15'),
      captureDate: new Date('2024-01-20'),
      metrics: { views: 1500 },
      tags: ['aws', 'lambda', 'serverless'],
      isClaimed: false,
      originalAuthor: 'john.doe@example.com',
      urls: [{ id: 'url-1', url: 'https://example.com/lambda-guide' }],
      createdAt: new Date('2024-01-20'),
      updatedAt: new Date('2024-01-20'),
    },
    {
      id: 'content-2',
      userId: 'system',
      title: 'Building Scalable APIs with API Gateway',
      description: 'Best practices for API design',
      contentType: 'youtube' as const,
      visibility: 'public' as const,
      publishDate: new Date('2024-02-01'),
      captureDate: new Date('2024-02-05'),
      metrics: { views: 2000 },
      tags: ['aws', 'api-gateway', 'rest'],
      isClaimed: false,
      originalAuthor: 'jane.smith@example.com',
      urls: [{ id: 'url-2', url: 'https://youtube.com/watch?v=abc123' }],
      createdAt: new Date('2024-02-05'),
      updatedAt: new Date('2024-02-05'),
    },
    {
      id: 'content-3',
      userId: 'system',
      title: 'DynamoDB Performance Optimization',
      description: 'Tips for optimizing DynamoDB queries',
      contentType: 'conference_talk' as const,
      visibility: 'public' as const,
      publishDate: new Date('2024-03-10'),
      captureDate: new Date('2024-03-15'),
      metrics: { attendees: 500 },
      tags: ['aws', 'dynamodb', 'performance'],
      isClaimed: false,
      originalAuthor: 'bob.wilson@example.com',
      urls: [{ id: 'url-3', url: 'https://conference.com/talk/123' }],
      createdAt: new Date('2024-03-15'),
      updatedAt: new Date('2024-03-15'),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUnclaimedContent.mockResolvedValue({
      content: mockUnclaimedContent,
      total: 3,
    });
  });

  describe('Browsing Unclaimed Content', () => {
    it('should display list of unclaimed content', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
        expect(screen.getByText('Building Scalable APIs with API Gateway')).toBeInTheDocument();
        expect(screen.getByText('DynamoDB Performance Optimization')).toBeInTheDocument();
      });
    });

    it('should display original author for each content', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText(/john\.doe@example\.com/)).toBeInTheDocument();
        expect(screen.getByText(/jane\.smith@example\.com/)).toBeInTheDocument();
        expect(screen.getByText(/bob\.wilson@example\.com/)).toBeInTheDocument();
      });
    });

    it('should display content type and tags', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('blog')).toBeInTheDocument();
        expect(screen.getByText('youtube')).toBeInTheDocument();
        expect(screen.getByText('conference_talk')).toBeInTheDocument();
        expect(screen.getByText('lambda')).toBeInTheDocument();
        expect(screen.getByText('api-gateway')).toBeInTheDocument();
      });
    });

    it('should show loading state while fetching content', () => {
      mockGetUnclaimedContent.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: [], total: 0 }), 1000))
      );

      render(<ClaimContentPage />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should display empty state when no unclaimed content', async () => {
      mockGetUnclaimedContent.mockResolvedValue({
        content: [],
        total: 0,
      });

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText(/no unclaimed content/i)).toBeInTheDocument();
      });
    });
  });

  describe('Search and Filter Functionality', () => {
    it('should filter content by search query', async () => {
      render(<ClaimContentPage />);

      const searchInput = await screen.findByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: 'Lambda' } });

      await waitFor(() => {
        expect(mockGetUnclaimedContent).toHaveBeenCalledWith(
          expect.objectContaining({ query: 'Lambda' })
        );
      });
    });

    it('should filter by content type', async () => {
      render(<ClaimContentPage />);

      const typeFilter = await screen.findByLabelText(/content type/i);
      fireEvent.change(typeFilter, { target: { value: 'blog' } });

      await waitFor(() => {
        expect(mockGetUnclaimedContent).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: 'blog' })
        );
      });
    });

    it('should filter by tags', async () => {
      render(<ClaimContentPage />);

      const tagFilter = await screen.findByLabelText(/tags/i);
      fireEvent.change(tagFilter, { target: { value: 'lambda' } });

      await waitFor(() => {
        expect(mockGetUnclaimedContent).toHaveBeenCalledWith(
          expect.objectContaining({ tags: 'lambda' })
        );
      });
    });

    it('should clear filters when reset button clicked', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
      fireEvent.change(searchInput, { target: { value: 'Lambda' } });

      await waitFor(() => {
        expect(searchInput.value).toBe('Lambda');
      });

      const resetButton = screen.getByRole('button', { name: /clear filters/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        const updatedSearchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
        expect(updatedSearchInput.value).toBe('');
      });

      await waitFor(() => {
        expect(mockGetUnclaimedContent).toHaveBeenCalledWith(undefined);
      });
    });
  });

  describe('Single Content Claiming', () => {
    it('should show claim button for each content item', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        const claimButtons = screen.getAllByRole('button', { name: /^claim$/i });
        expect(claimButtons).toHaveLength(3);
      });
    });

    it('should show confirmation dialog when claim button clicked', async () => {
      render(<ClaimContentPage />);

      const claimButtons = await screen.findAllByRole('button', { name: /^claim$/i });
      fireEvent.click(claimButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/confirm claim/i)).toBeInTheDocument();
        expect(screen.getByText(/are you sure you want to claim/i)).toBeInTheDocument();
      });
    });

    it('should claim content when confirmation accepted', async () => {
      mockClaimContent.mockResolvedValue({
        success: true,
        content: { ...mockUnclaimedContent[0], isClaimed: true },
      });

      render(<ClaimContentPage />);

      const claimButtons = await screen.findAllByRole('button', { name: /^claim$/i });
      fireEvent.click(claimButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockClaimContent).toHaveBeenCalledWith('content-1');
      });
    });

    it('should show success notification after claiming', async () => {
      mockClaimContent.mockResolvedValue({
        success: true,
        content: { ...mockUnclaimedContent[0], isClaimed: true },
      });

      render(<ClaimContentPage />);

      const claimButtons = await screen.findAllByRole('button', { name: /^claim$/i });
      fireEvent.click(claimButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/successfully claimed/i)).toBeInTheDocument();
      });
    });

    it('should show error notification on claim failure', async () => {
      mockClaimContent.mockRejectedValue(
        new Error('Content already claimed')
      );

      render(<ClaimContentPage />);

      const claimButtons = await screen.findAllByRole('button', { name: /^claim$/i });
      fireEvent.click(claimButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to claim/i)).toBeInTheDocument();
        expect(screen.getByText(/already claimed/i)).toBeInTheDocument();
      });
    });

    it('should remove claimed content from list after success', async () => {
      mockClaimContent.mockResolvedValue({
        success: true,
        content: { ...mockUnclaimedContent[0], isClaimed: true },
      });

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const claimButtons = screen.getAllByRole('button', { name: /^claim$/i });
      fireEvent.click(claimButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.queryByText('Getting Started with AWS Lambda')).not.toBeInTheDocument();
      });
    });
  });

  describe('Bulk Claim Functionality', () => {
    it('should show checkboxes for selecting multiple items', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should enable bulk claim button when items selected', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Skip checkboxes[0] which is "Select All", click items 1 and 2
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      const bulkClaimButton = screen.getByRole('button', { name: /claim selected/i });
      expect(bulkClaimButton).toBeEnabled();
    });

    it('should disable bulk claim button when no items selected', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        const bulkClaimButton = screen.getByRole('button', { name: /claim selected/i });
        expect(bulkClaimButton).toBeDisabled();
      });
    });

    it('should show count of selected items', async () => {
      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Skip checkboxes[0] which is "Select All", click items 1 and 2
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      await waitFor(() => {
        expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
      });
    });

    it('should select all items when select all clicked', async () => {
      render(<ClaimContentPage />);

      const selectAllCheckbox = await screen.findByLabelText(/select all/i);
      fireEvent.click(selectAllCheckbox);

      await waitFor(() => {
        expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
      });
    });

    it('should claim multiple items when bulk claim confirmed', async () => {
      mockBulkClaimContent.mockResolvedValue({
        success: true,
        claimed: 2,
        failed: 0,
      });

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Skip checkboxes[0] which is "Select All", click items 1 and 2
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      const bulkClaimButton = screen.getByRole('button', { name: /claim selected/i });
      fireEvent.click(bulkClaimButton);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockBulkClaimContent).toHaveBeenCalledWith(['content-1', 'content-2']);
      });
    });

    it('should show success notification for bulk claim', async () => {
      mockBulkClaimContent.mockResolvedValue({
        success: true,
        claimed: 2,
        failed: 0,
      });

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Skip checkboxes[0] which is "Select All", click items 1 and 2
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      const bulkClaimButton = screen.getByRole('button', { name: /claim selected/i });
      fireEvent.click(bulkClaimButton);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/successfully claimed 2 items/i)).toBeInTheDocument();
      });
    });

    it('should show partial success notification when some claims fail', async () => {
      mockBulkClaimContent.mockResolvedValue({
        success: true,
        claimed: 1,
        failed: 1,
        errors: [{ contentId: 'content-2', error: 'Already claimed by another user' }],
      });

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Skip checkboxes[0] which is "Select All", click items 1 and 2
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      const bulkClaimButton = screen.getByRole('button', { name: /claim selected/i });
      fireEvent.click(bulkClaimButton);

      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/claimed 1 of 2 items/i)).toBeInTheDocument();
        expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when fetching content fails', async () => {
      mockGetUnclaimedContent.mockRejectedValue(
        new Error('Network error')
      );

      render(<ClaimContentPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
    });

    it('should show retry button on fetch error', async () => {
      mockGetUnclaimedContent.mockRejectedValue(
        new Error('Network error')
      );

      render(<ClaimContentPage />);

      await waitFor(() => {
        const retryButton = screen.getByRole('button', { name: /retry/i });
        expect(retryButton).toBeInTheDocument();
      });
    });

    it('should retry fetching when retry button clicked', async () => {
      mockGetUnclaimedContent
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ content: mockUnclaimedContent, total: 3 });

      render(<ClaimContentPage />);

      await waitFor(() => {
        const retryButton = screen.getByRole('button', { name: /retry/i });
        fireEvent.click(retryButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Getting Started with AWS Lambda')).toBeInTheDocument();
      });
    });
  });
});
