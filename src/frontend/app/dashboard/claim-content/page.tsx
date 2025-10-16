'use client';

/**
 * Content Claiming Interface
 * Task 6.7: Browse and claim unclaimed content
 */

import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Content, ContentType } from '@shared/types';

interface Notification {
  type: 'success' | 'error' | 'info';
  message: string;
  details?: string;
}

interface ConfirmDialog {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ClaimContentPage() {
  const [content, setContent] = useState<Content[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [contentTypeFilter, setContentTypeFilter] = useState('');
  const [tagsFilter, setTagsFilter] = useState('');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch unclaimed content
  const fetchUnclaimedContent = async (filters?: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getUnclaimedContent(filters);
      setContent(response.content);
      setTotal(response.total);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to load unclaimed content';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnclaimedContent();
  }, []);

  // Handle search and filters
  useEffect(() => {
    const filters: any = {};

    if (searchQuery) filters.query = searchQuery;
    if (contentTypeFilter) filters.contentType = contentTypeFilter;
    if (tagsFilter) filters.tags = tagsFilter;

    const timeoutId = setTimeout(() => {
      fetchUnclaimedContent(Object.keys(filters).length > 0 ? filters : /* istanbul ignore next */ undefined);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, contentTypeFilter, tagsFilter]);

  const clearFilters = () => {
    setSearchQuery('');
    setContentTypeFilter('');
    setTagsFilter('');
    fetchUnclaimedContent();
  };

  const showNotification = (type: 'success' | 'error' | 'info', message: string, details?: string) => {
    setNotification({ type, message, details });
    setTimeout(() => setNotification(null), 5000);
  };

  const showConfirmDialog = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      onConfirm,
      onCancel: () => setConfirmDialog(null),
    });
  };

  const handleClaimContent = async (contentId: string) => {
    const contentItem = content.find(c => c.id === contentId);
    if (!contentItem) return;

    showConfirmDialog(
      'Confirm Claim',
      `Are you sure you want to claim "${contentItem.title}"?`,
      async () => {
        setConfirmDialog(null);
        try {
          await apiClient.claimContent(contentId);
          showNotification('success', 'Successfully claimed content');
          setContent(prev => prev.filter(c => c.id !== contentId));
          setTotal(prev => prev - 1);
        } catch (err) {
      const errorMessage = err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to claim content';
          showNotification('error', 'Failed to claim content', errorMessage);
        }
      }
    );
  };

  const handleBulkClaim = () => {
    const selectedCount = selectedIds.size;

    showConfirmDialog(
      'Confirm Bulk Claim',
      `Are you sure you want to claim ${selectedCount} selected items?`,
      async () => {
        setConfirmDialog(null);
        try {
          const result = await apiClient.bulkClaimContent(Array.from(selectedIds));

          if (result.failed > 0) {
            showNotification(
              'info',
              `Claimed ${result.claimed} of ${selectedCount} items`,
              `${result.failed} failed`
            );
          } else {
            showNotification('success', `Successfully claimed ${result.claimed} items`);
          }

          // Remove claimed items from list
          setContent(prev => prev.filter(c => !selectedIds.has(c.id)));
          setTotal(prev => prev - result.claimed);
          setSelectedIds(new Set());
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to claim content';
          showNotification('error', 'Failed to claim content', errorMessage);
        }
      }
    );
  };

  const toggleSelection = (contentId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contentId)) {
        newSet.delete(contentId);
      } else {
        newSet.add(contentId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === content.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(content.map(c => c.id)));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="text-lg text-gray-600">Loading unclaimed content...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h3 className="text-lg font-semibold text-red-800 mb-2">Failed to load content</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => fetchUnclaimedContent()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Claim Content</h1>
          <p className="text-gray-600">
            Browse and claim unclaimed content created by community members
          </p>
        </div>

        {/* Notifications */}
        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              notification.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : notification.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            <p className="font-semibold">{notification.message}</p>
            {notification.details && (
              <p className="text-sm mt-1">{notification.details}</p>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <input
                type="text"
                placeholder="Search content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <select
                value={contentTypeFilter}
                onChange={(e) => setContentTypeFilter(e.target.value)}
                aria-label="Content Type"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Types</option>
                <option value="blog">Blog</option>
                <option value="youtube">YouTube</option>
                <option value="github">GitHub</option>
                <option value="conference_talk">Conference Talk</option>
                <option value="podcast">Podcast</option>
              </select>
            </div>

            <div>
              <input
                type="text"
                placeholder="Filter by tags..."
                value={tagsFilter}
                onChange={(e) => setTagsFilter(e.target.value)}
                aria-label="Tags"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <button
                onClick={clearFilters}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={content.length > 0 && selectedIds.size === content.length}
                onChange={toggleSelectAll}
                aria-label="Select All"
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Select All</span>
            </label>

            {selectedIds.size > 0 && (
              <span className="text-sm text-gray-600">
                {selectedIds.size} selected
              </span>
            )}
          </div>

          <button
            onClick={handleBulkClaim}
            disabled={selectedIds.size === 0}
            className={`px-6 py-2 rounded-lg font-medium ${
              selectedIds.size === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            Claim Selected
          </button>
        </div>

        {/* Content List */}
        {content.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <p className="text-lg text-gray-600">No unclaimed content available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {content.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelection(item.id)}
                    className="mt-1 w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />

                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-1">
                          {item.title}
                        </h3>
                        {item.description && (
                          <p className="text-gray-600 mb-2">{item.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                        {item.contentType}
                      </span>
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-6 text-sm text-gray-500 mb-3">
                      {item.originalAuthor && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Original Author:</span>
                          <span>{item.originalAuthor}</span>
                        </div>
                      )}
                      {item.publishDate && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Published:</span>
                          <span>{new Date(item.publishDate).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    {item.urls.length > 0 && (
                      <div className="mb-3">
                        <a
                          href={item.urls[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-sm break-all"
                        >
                          {item.urls[0].url}
                        </a>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleClaimContent(item.id)}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                  >
                    Claim
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Confirmation Dialog */}
        {confirmDialog && confirmDialog.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {confirmDialog.title}
              </h3>
              <p className="text-gray-600 mb-6">{confirmDialog.message}</p>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={confirmDialog.onCancel}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
