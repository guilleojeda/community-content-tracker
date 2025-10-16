/**
 * Content Management UI Tests
 * Task 6.2: Comprehensive test suite for content CRUD operations
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ContentManagementPage from '../../../../../src/frontend/app/dashboard/content/page';
import { apiClient } from '../../../../../src/frontend/src/api/client';
import { ContentType, Visibility } from '../../../../../src/shared/types';

// Mock the API client
jest.mock('../../../../../src/frontend/src/api/client');

const mockContent = [
  {
    id: '1',
    userId: 'user-1',
    title: 'Test Blog Post',
    description: 'A test blog post',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2024-01-01'),
    captureDate: new Date('2024-01-01'),
    metrics: { views: 100 },
    tags: ['aws', 'serverless'],
    urls: [{ id: 'url-1', url: 'https://example.com/blog' }],
    isClaimed: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    userId: 'user-1',
    title: 'Test YouTube Video',
    description: 'A test video',
    contentType: ContentType.YOUTUBE,
    visibility: Visibility.AWS_COMMUNITY,
    publishDate: new Date('2024-01-02'),
    captureDate: new Date('2024-01-02'),
    metrics: { views: 500 },
    tags: ['lambda', 'api-gateway'],
    urls: [{ id: 'url-2', url: 'https://youtube.com/watch?v=test' }],
    isClaimed: true,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
];

describe('Content Management Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.listContent as jest.Mock).mockResolvedValue({ content: mockContent, total: 2 });
  });

  describe('Content List Display', () => {
    it('should render content list with all items', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
        expect(screen.getByText('Test YouTube Video')).toBeInTheDocument();
      });
    });

    it('should display content metadata correctly', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      await waitFor(() => {
        const firstContent = screen.getByText('Test Blog Post').closest('article');
        expect(within(firstContent!).getByText('blog')).toBeInTheDocument();
        expect(within(firstContent!).getByText('public')).toBeInTheDocument();
        expect(within(firstContent!).getByText('aws')).toBeInTheDocument();
        expect(within(firstContent!).getByText('serverless')).toBeInTheDocument();
      });
    });
  });

  describe('Content Filtering', () => {
    it('should filter by content type', async () => {
      render(<ContentManagementPage />);

      const typeFilter = await screen.findByLabelText(/content type/i);
      await userEvent.selectOptions(typeFilter, ContentType.BLOG);

      await waitFor(() => {
        expect(apiClient.listContent).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: ContentType.BLOG })
        );
      });
    });

    it('should filter by visibility', async () => {
      render(<ContentManagementPage />);

      const visibilityFilter = await screen.findByLabelText(/visibility/i);
      await userEvent.selectOptions(visibilityFilter, Visibility.PUBLIC);

      await waitFor(() => {
        expect(apiClient.listContent).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: Visibility.PUBLIC })
        );
      });
    });

    it('should filter by tags', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const tagInput = screen.getByPlaceholderText(/filter by tags/i);

      // Use fireEvent to directly change the input value
      await act(async () => {
        fireEvent.change(tagInput, { target: { value: 'aws' } });
      });

      await waitFor(() => {
        // Check that listContent was called with tags filter containing 'aws'
        expect(apiClient.listContent).toHaveBeenCalledWith(
          expect.objectContaining({ tags: ['aws'] })
        );
      }, { timeout: 3000 });
    });

    it('should combine multiple filters', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const typeFilter = screen.getByLabelText(/content type/i);
      const visibilityFilter = screen.getByLabelText(/visibility/i);

      await act(async () => {
        fireEvent.change(typeFilter, { target: { value: ContentType.YOUTUBE } });
      });

      // Wait for the first filter to be applied
      await waitFor(() => {
        expect(apiClient.listContent).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: ContentType.YOUTUBE })
        );
      });

      await act(async () => {
        fireEvent.change(visibilityFilter, { target: { value: Visibility.AWS_COMMUNITY } });
      });

      // Wait for both filters to be applied together
      await waitFor(() => {
        expect(apiClient.listContent).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: ContentType.YOUTUBE,
            visibility: Visibility.AWS_COMMUNITY,
          })
        );
      }, { timeout: 3000 });
    });
  });

  describe('Add Content Form', () => {
    it('should open add content modal when clicking add button', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      });
    });

    it('should validate required fields', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const submitButton = within(screen.getByRole('dialog')).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/title is required/i)).toBeInTheDocument();
        expect(screen.getByText(/content type is required/i)).toBeInTheDocument();
        expect(screen.getByText(/at least one url is required/i)).toBeInTheDocument();
      });
    });

    it('should create content successfully', async () => {
      (apiClient.createContent as jest.Mock).mockResolvedValue({
        id: '3',
        title: 'New Content',
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/title/i), 'New Content');
      await userEvent.type(within(dialog).getByLabelText(/description/i), 'New Description');
      await userEvent.selectOptions(within(dialog).getByLabelText(/content type/i), ContentType.BLOG);
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://example.com/new');
      await userEvent.type(within(dialog).getByLabelText(/tags/i), 'aws,serverless');

      const submitButton = within(dialog).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(apiClient.createContent).toHaveBeenCalledWith({
          title: 'New Content',
          description: 'New Description',
          contentType: ContentType.BLOG,
          visibility: Visibility.PRIVATE,
          urls: ['https://example.com/new'],
          tags: ['aws', 'serverless'],
          isClaimed: true,
        });
      });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should create conference talk content', async () => {
      (apiClient.createContent as jest.Mock).mockResolvedValue({
        id: '4',
        title: 'AWS re:Invent Keynote',
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/title/i), 'AWS re:Invent Keynote');
      await userEvent.type(within(dialog).getByLabelText(/description/i), 'Keynote about serverless');
      await userEvent.selectOptions(within(dialog).getByLabelText(/content type/i), ContentType.CONFERENCE_TALK);
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://youtube.com/watch?v=keynote');
      await userEvent.type(within(dialog).getByLabelText(/tags/i), 'aws,reinvent');

      const submitButton = within(dialog).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(apiClient.createContent).toHaveBeenCalledWith({
          title: 'AWS re:Invent Keynote',
          description: 'Keynote about serverless',
          contentType: ContentType.CONFERENCE_TALK,
          visibility: Visibility.PRIVATE,
          urls: ['https://youtube.com/watch?v=keynote'],
          tags: ['aws', 'reinvent'],
          isClaimed: true,
        });
      });
    });

    it('should create podcast content', async () => {
      (apiClient.createContent as jest.Mock).mockResolvedValue({
        id: '5',
        title: 'AWS Podcast Episode',
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/title/i), 'AWS Podcast Episode');
      await userEvent.type(within(dialog).getByLabelText(/description/i), 'Discussing Lambda functions');
      await userEvent.selectOptions(within(dialog).getByLabelText(/content type/i), ContentType.PODCAST);
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://podcast.com/episode/42');
      await userEvent.type(within(dialog).getByLabelText(/tags/i), 'aws,lambda,podcast');

      const submitButton = within(dialog).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(apiClient.createContent).toHaveBeenCalledWith({
          title: 'AWS Podcast Episode',
          description: 'Discussing Lambda functions',
          contentType: ContentType.PODCAST,
          visibility: Visibility.PRIVATE,
          urls: ['https://podcast.com/episode/42'],
          tags: ['aws', 'lambda', 'podcast'],
          isClaimed: true,
        });
      });
    });

    it('should create github content', async () => {
      (apiClient.createContent as jest.Mock).mockResolvedValue({
        id: '6',
        title: 'AWS CDK Construct Library',
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/title/i), 'AWS CDK Construct Library');
      await userEvent.type(within(dialog).getByLabelText(/description/i), 'Custom CDK constructs');
      await userEvent.selectOptions(within(dialog).getByLabelText(/content type/i), ContentType.GITHUB);
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://github.com/user/aws-cdk-lib');
      await userEvent.type(within(dialog).getByLabelText(/tags/i), 'aws,cdk,github');

      const submitButton = within(dialog).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(apiClient.createContent).toHaveBeenCalledWith({
          title: 'AWS CDK Construct Library',
          description: 'Custom CDK constructs',
          contentType: ContentType.GITHUB,
          visibility: Visibility.PRIVATE,
          urls: ['https://github.com/user/aws-cdk-lib'],
          tags: ['aws', 'cdk', 'github'],
          isClaimed: true,
        });
      });
    });

    it('should support multiple URLs', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');

      // Add first URL
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://example.com/1');

      // Click add another URL
      const addUrlButton = within(dialog).getByRole('button', { name: /add another url/i });
      await userEvent.click(addUrlButton);

      // Add second URL
      await waitFor(() => {
        const urlInputs = within(dialog).getAllByLabelText(/url/i);
        expect(urlInputs).toHaveLength(2);
      });

      const urlInputs = within(dialog).getAllByLabelText(/url/i);
      await userEvent.type(urlInputs[1], 'https://example.com/2');
    });
  });

  describe('Edit Content Modal', () => {
    it('should open edit modal with pre-filled data', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const editButton = screen.getAllByRole('button', { name: /edit/i })[0];
      await userEvent.click(editButton);

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByDisplayValue('Test Blog Post')).toBeInTheDocument();
      expect(within(dialog).getByDisplayValue('A test blog post')).toBeInTheDocument();
    });

    it('should update content successfully', async () => {
      (apiClient.updateContent as jest.Mock).mockResolvedValue({
        id: '1',
        title: 'Updated Title',
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const editButton = screen.getAllByRole('button', { name: /edit/i })[0];
      await userEvent.click(editButton);

      const dialog = screen.getByRole('dialog');
      const titleInput = within(dialog).getByDisplayValue('Test Blog Post');

      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, 'Updated Title');

      const saveButton = within(dialog).getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(apiClient.updateContent).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({ title: 'Updated Title' })
        );
      });
    });

    it('should allow changing visibility', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const editButton = screen.getAllByRole('button', { name: /edit/i })[0];
      await userEvent.click(editButton);

      const dialog = screen.getByRole('dialog');
      const visibilitySelect = within(dialog).getByLabelText(/visibility/i);

      await userEvent.selectOptions(visibilitySelect, Visibility.PRIVATE);

      const saveButton = within(dialog).getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(apiClient.updateContent).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({ visibility: Visibility.PRIVATE })
        );
      });
    });
  });

  describe('Delete Confirmation', () => {
    it('should show confirmation dialog when deleting', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByRole('button', { name: /delete/i })[0];
      await userEvent.click(deleteButton);

      expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should delete content when confirmed', async () => {
      (apiClient.deleteContent as jest.Mock).mockResolvedValue({ success: true });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByRole('button', { name: /delete/i })[0];
      await userEvent.click(deleteButton);

      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      await userEvent.click(confirmButton);

      await waitFor(() => {
        expect(apiClient.deleteContent).toHaveBeenCalledWith('1');
      });

      await waitFor(() => {
        expect(apiClient.listContent).toHaveBeenCalled();
      });
    });

    it('should not delete when cancelled', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByRole('button', { name: /delete/i })[0];
      await userEvent.click(deleteButton);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelButton);

      expect(apiClient.deleteContent).not.toHaveBeenCalled();
    });
  });

  describe('Bulk Actions', () => {
    it('should enable bulk selection', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox', { name: /select content/i });
      expect(checkboxes).toHaveLength(2);

      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);

      expect(screen.getByText(/2 items selected/i)).toBeInTheDocument();
    });

    it('should select all items', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
      await userEvent.click(selectAllCheckbox);

      expect(screen.getByText(/2 items selected/i)).toBeInTheDocument();
    });

    it('should change visibility for selected items', async () => {
      (apiClient.bulkUpdateVisibility as jest.Mock).mockResolvedValue({ updated: 2 });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      // Select items
      const checkboxes = screen.getAllByRole('checkbox', { name: /select content/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);

      // Change visibility
      const bulkVisibilitySelect = screen.getByLabelText(/bulk change visibility/i);
      await userEvent.selectOptions(bulkVisibilitySelect, Visibility.PRIVATE);

      const applyButton = screen.getByRole('button', { name: /apply to selected/i });
      await userEvent.click(applyButton);

      await waitFor(() => {
        expect(apiClient.bulkUpdateVisibility).toHaveBeenCalledWith(['1', '2'], Visibility.PRIVATE);
      });
    });
  });

  describe('Content Preview', () => {
    it('should show preview when clicking preview button', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0];
      await userEvent.click(previewButton);

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Test Blog Post')).toBeInTheDocument();
      expect(within(dialog).getByText('A test blog post')).toBeInTheDocument();
      expect(within(dialog).getByText('https://example.com/blog')).toBeInTheDocument();
    });

    it('should display all content metadata in preview', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0];
      await userEvent.click(previewButton);

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Test Blog Post')).toBeInTheDocument();
      });

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('blog')).toBeInTheDocument();
        expect(within(dialog).getByText('public')).toBeInTheDocument();
        expect(within(dialog).getByText('aws')).toBeInTheDocument();
        expect(within(dialog).getByText('serverless')).toBeInTheDocument();
      });
    });
  });

  describe('URL Management', () => {
    it('should display all URLs for content', async () => {
      const contentWithMultipleUrls = {
        ...mockContent[0],
        urls: [
          { id: 'url-1', url: 'https://example.com/blog' },
          { id: 'url-2', url: 'https://mirror.com/blog' },
        ],
      };

      (apiClient.listContent as jest.Mock).mockResolvedValue({
        content: [contentWithMultipleUrls],
        total: 1,
      });

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const previewButton = screen.getByRole('button', { name: /preview/i });
      await userEvent.click(previewButton);

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('https://example.com/blog')).toBeInTheDocument();
      expect(within(dialog).getByText('https://mirror.com/blog')).toBeInTheDocument();
    });
  });

  describe('Tag Management', () => {
    it('should display tags as badges', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const contentCard = screen.getByText('Test Blog Post').closest('article');
      expect(within(contentCard!).getByText('aws')).toBeInTheDocument();
      expect(within(contentCard!).getByText('serverless')).toBeInTheDocument();
    });

    it('should allow editing tags', async () => {
      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const editButton = screen.getAllByRole('button', { name: /edit/i })[0];
      await userEvent.click(editButton);

      const dialog = screen.getByRole('dialog');
      const tagsInput = within(dialog).getByLabelText(/tags/i);

      await userEvent.clear(tagsInput);
      await userEvent.type(tagsInput, 'dynamodb,cloudformation');

      const saveButton = within(dialog).getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(apiClient.updateContent).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({ tags: ['dynamodb', 'cloudformation'] })
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error when fetching content fails', async () => {
      (apiClient.listContent as jest.Mock).mockRejectedValue(new Error('Failed to fetch'));

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load content/i)).toBeInTheDocument();
      });
    });

    it('should display error when creating content fails', async () => {
      (apiClient.createContent as jest.Mock).mockRejectedValue(new Error('Failed to create'));

      render(<ContentManagementPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add content/i });
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/title/i), 'New Content');
      await userEvent.selectOptions(within(dialog).getByLabelText(/content type/i), ContentType.BLOG);
      await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://example.com/new');

      const submitButton = within(dialog).getByRole('button', { name: /create/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to create content/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading spinner while fetching content', () => {
      (apiClient.listContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<ContentManagementPage />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });
});
