'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Content, ContentType, Visibility } from '@shared/types';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

interface ContentFormData {
  title: string;
  description: string;
  contentType: ContentType | '';
  visibility: Visibility;
  urls: string[];
  tags: string;
}

interface ContentFilters {
  contentType?: string;
  visibility?: string;
  tags?: string[];
}

// URL validation function
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export default function ContentManagementPage() {
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [contentTypeFilter, setContentTypeFilter] = useState<string>('');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('');
  const [tagsFilter, setTagsFilter] = useState<string>('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkVisibility, setBulkVisibility] = useState<Visibility | ''>('');

  // Form state
  const [formData, setFormData] = useState<ContentFormData>({
    title: '',
    description: '',
    contentType: '',
    visibility: Visibility.PRIVATE,
    urls: [''],
    tags: '',
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchContent = useCallback(async (
    nextContentType: string,
    nextVisibility: string,
    nextTags: string
  ) => {
    setLoading(true);
    setError(null);
    try {
      const filters: ContentFilters = {};
      if (nextContentType) filters.contentType = nextContentType;
      if (nextVisibility) filters.visibility = nextVisibility;
      if (nextTags) filters.tags = [nextTags];

      const client = await loadSharedApiClient();
      const result = await client.listContent(filters);
      setContent(result.content || /* istanbul ignore next */ []);
    } catch (err) {
      setError('Failed to load content. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContent(contentTypeFilter, visibilityFilter, tagsFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (nextContentType: string, nextVisibility: string, nextTags: string) => {
    fetchContent(nextContentType, nextVisibility, nextTags);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.title.trim()) {
      errors.title = 'Title is required';
    }
    if (!formData.contentType) {
      errors.contentType = 'Content type is required';
    }

    const nonEmptyUrls = formData.urls.filter(url => url.trim());
    if (nonEmptyUrls.length === 0) {
      errors.urls = 'At least one URL is required';
    } else {
      // Validate URL format
      const invalidUrls = nonEmptyUrls.filter(url => !isValidUrl(url));
      if (invalidUrls.length > 0) {
        errors.urls = 'All URLs must be valid (e.g., https://example.com)';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddContent = async () => {
    if (!validateForm()) return;

    setFormSubmitting(true);
    setError(null);

    try {
      const client = await loadSharedApiClient();
      await client.createContent({
        title: formData.title,
        description: formData.description || /* istanbul ignore next */ undefined,
        contentType: formData.contentType as ContentType,
        visibility: formData.visibility,
        urls: formData.urls.filter(url => url.trim()),
        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : /* istanbul ignore next */ undefined,
        isClaimed: true,
      });

      setShowAddModal(false);
      resetForm();
      await fetchContent(contentTypeFilter, visibilityFilter, tagsFilter);
    } catch (err) {
      setError('Failed to create content. Please try again.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleEditContent = async () => {
    if (!selectedContent || !validateForm()) return;

    setFormSubmitting(true);
    setError(null);

    try {
      const client = await loadSharedApiClient();
      await client.updateContent(selectedContent.id, {
        title: formData.title,
        description: formData.description || /* istanbul ignore next */ undefined,
        contentType: formData.contentType as ContentType,
        visibility: formData.visibility,
        urls: formData.urls.filter(url => url.trim()),
        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : /* istanbul ignore next */ undefined,
      });

      setShowEditModal(false);
      setSelectedContent(null);
      resetForm();
      await fetchContent(contentTypeFilter, visibilityFilter, tagsFilter);
    } catch (err) {
      setError('Failed to update content. Please try again.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteContent = async () => {
    if (!selectedContent) return;

    try {
      const client = await loadSharedApiClient();
      await client.deleteContent(selectedContent.id);
      setShowDeleteConfirm(false);
      setSelectedContent(null);
      await fetchContent(contentTypeFilter, visibilityFilter, tagsFilter);
    } catch (err) {
      setError('Failed to delete content. Please try again.');
    }
  };

  const openEditModal = (item: Content) => {
    setSelectedContent(item);
    setFormData({
      title: item.title,
      description: item.description || /* istanbul ignore next */ '',
      contentType: item.contentType,
      visibility: item.visibility,
      urls: item.urls.map(u => u.url),
      tags: item.tags.join(','),
    });
    setFormErrors({});
    setShowEditModal(true);
  };

  const openPreview = (item: Content) => {
    setSelectedContent(item);
    setShowPreview(true);
  };

  const openDeleteConfirm = (item: Content) => {
    setSelectedContent(item);
    setShowDeleteConfirm(true);
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      contentType: '',
      visibility: Visibility.PRIVATE,
      urls: [''],
      tags: '',
    });
    setFormErrors({});
  };

  const handleBulkVisibilityChange = async () => {
    if (selectedIds.length === 0 || !bulkVisibility) return;

    try {
      const client = await loadSharedApiClient();
      await client.bulkUpdateVisibility(selectedIds, bulkVisibility);
      setSelectedIds([]);
      setBulkVisibility('');
      await fetchContent(contentTypeFilter, visibilityFilter, tagsFilter);
    } catch (err) {
      setError('Failed to update visibility. Please try again.');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === content.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(content.map(c => c.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? /* istanbul ignore next */ prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const addUrlField = () => {
    setFormData(prev => ({ ...prev, urls: [...prev.urls, ''] }));
  };

  const updateUrl = (index: number, value: string) => {
    setFormData(prev => {
      const newUrls = [...prev.urls];
      newUrls[index] = value;
      return { ...prev, urls: newUrls };
    });
  };

  if (loading) {
    return (
      <div className="p-8">
        <div role="status" className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-3xl font-bold">Content Management</h1>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Content
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="contentTypeFilter" className="block text-sm font-medium mb-1">
              Content Type
            </label>
            <select
              id="contentTypeFilter"
              value={contentTypeFilter}
              onChange={(e) => {
                const value = e.target.value;
                setContentTypeFilter(value);
                handleFilterChange(value, visibilityFilter, tagsFilter);
              }}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">All Types</option>
              {Object.values(ContentType).map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="visibilityFilter" className="block text-sm font-medium mb-1">
              Visibility
            </label>
            <select
              id="visibilityFilter"
              value={visibilityFilter}
              onChange={(e) => {
                const value = e.target.value;
                setVisibilityFilter(value);
                handleFilterChange(contentTypeFilter, value, tagsFilter);
              }}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">All Visibility</option>
              {Object.values(Visibility).map(vis => (
                <option key={vis} value={vis}>{vis}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tagsFilter" className="block text-sm font-medium mb-1">
              Tags
            </label>
            <input
              id="tagsFilter"
              type="text"
              value={tagsFilter}
              onChange={(e) => {
                const value = e.target.value;
                setTagsFilter(value);
                handleFilterChange(contentTypeFilter, visibilityFilter, value);
              }}
              placeholder="Filter by tags"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="flex items-center gap-4">
            <span className="font-medium">{selectedIds.length} items selected</span>
            <label htmlFor="bulkVisibility" className="text-sm">Bulk Change Visibility:</label>
            <select
              id="bulkVisibility"
              value={bulkVisibility}
              onChange={(e) => setBulkVisibility(e.target.value as Visibility)}
              className="border rounded px-3 py-1"
            >
              <option value="">Select visibility...</option>
              {Object.values(Visibility).map(vis => (
                <option key={vis} value={vis}>{vis}</option>
              ))}
            </select>
            <button
              onClick={handleBulkVisibilityChange}
              disabled={!bulkVisibility}
              className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Apply to Selected
            </button>
          </div>
        </div>
      )}

      {/* Content List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b flex items-center">
          <input
            type="checkbox"
            checked={selectedIds.length === content.length && content.length > 0}
            onChange={toggleSelectAll}
            aria-label="Select all"
            className="mr-3"
          />
          <span className="font-medium">Select All</span>
        </div>

        <div className="divide-y">
          {content.map((item) => (
            <article key={item.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  aria-label="Select content"
                  className="mt-1"
                />

                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{item.title}</h3>
                  {item.description && (
                    <p className="text-gray-600 mt-1">{item.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {item.contentType}
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">
                      {item.visibility}
                    </span>
                    {item.tags.map((tag: string) => (
                      <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openPreview(item)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => openEditModal(item)}
                    className="text-sm text-green-600 hover:text-green-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => openDeleteConfirm(item)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div role="dialog" className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4">
              {showAddModal ? 'Add Content' : 'Edit Content'}
            </h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="title" className="block text-sm font-medium mb-1">
                  Title *
                </label>
                <input
                  id="title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
                {formErrors.title && (
                  <p className="text-red-600 text-sm mt-1">{formErrors.title}</p>
                )}
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="contentType" className="block text-sm font-medium mb-1">
                  Content Type *
                </label>
                <select
                  id="contentType"
                  value={formData.contentType}
                  onChange={(e) => setFormData({ ...formData, contentType: e.target.value as ContentType })}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Select type...</option>
                  {Object.values(ContentType).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                {formErrors.contentType && (
                  <p className="text-red-600 text-sm mt-1">{formErrors.contentType}</p>
                )}
              </div>

              <div>
                <label htmlFor="visibility" className="block text-sm font-medium mb-1">
                  Visibility
                </label>
                <select
                  id="visibility"
                  value={formData.visibility}
                  onChange={(e) => setFormData({ ...formData, visibility: e.target.value as Visibility })}
                  className="w-full border rounded px-3 py-2"
                >
                  {Object.values(Visibility).map(vis => (
                    <option key={vis} value={vis}>{vis}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">URLs *</label>
                {formData.urls.map((url: string, index: number) => (
                  <input
                    key={index}
                    type="text"
                    value={url}
                    onChange={(e) => updateUrl(index, e.target.value)}
                    placeholder="https://example.com"
                    aria-label="URL"
                    className="w-full border rounded px-3 py-2 mb-2"
                  />
                ))}
                <button
                  type="button"
                  onClick={addUrlField}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Add Another URL
                </button>
                {formErrors.urls && (
                  <p className="text-red-600 text-sm mt-1">{formErrors.urls}</p>
                )}
              </div>

              <div>
                <label htmlFor="tags" className="block text-sm font-medium mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  id="tags"
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="aws,serverless,lambda"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  showAddModal ? setShowAddModal(false) : setShowEditModal(false);
                  resetForm();
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={showAddModal ? handleAddContent : handleEditContent}
                disabled={formSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {formSubmitting ? 'Saving...' : (showAddModal ? 'Create' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && selectedContent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div role="dialog" className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4">{selectedContent.title}</h2>

            {selectedContent.description && (
              <p className="text-gray-600 mb-4">{selectedContent.description}</p>
            )}

            <div className="space-y-3">
              <div>
                <span className="font-medium">Type: </span>
                <span className="text-blue-600">{selectedContent.contentType}</span>
              </div>

              <div>
                <span className="font-medium">Visibility: </span>
                <span className="text-gray-600">{selectedContent.visibility}</span>
              </div>

              {selectedContent.tags.length > 0 && (
                <div>
                  <span className="font-medium">Tags: </span>
                  {selectedContent.tags.map((tag: string) => (
                    <span key={tag} className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-sm mr-2">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <span className="font-medium">URLs:</span>
                <ul className="list-disc list-inside mt-2">
                  {selectedContent.urls.map((urlObj: { id: string; url: string }) => (
                    <li key={urlObj.id}>
                      <a href={urlObj.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {urlObj.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setShowPreview(false);
                  setSelectedContent(null);
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && selectedContent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Confirm Deletion</h3>
            <p className="mb-6">
              Are you sure you want to delete &ldquo;{selectedContent.title}&rdquo;? This action cannot be undone.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setSelectedContent(null);
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteContent}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
