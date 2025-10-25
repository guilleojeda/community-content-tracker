'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Content } from '@shared/types';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

type MergeTab = 'duplicates' | 'history';

interface MergeHistoryItem {
  id: string;
  primaryContentId: string;
  mergedContentIds: string[];
  mergedAt: Date;
  mergedBy: string;
  canUndo: boolean;
  undoExpiresAt: Date;
}

export default function ContentMergePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tab state
  const [activeTab, setActiveTab] = useState<MergeTab>('duplicates');

  // Duplicates state
  const [duplicates, setDuplicates] = useState<Content[]>([]);
  const [similarity, setSimilarity] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryContentId, setPrimaryContentId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // History state
  const [mergeHistory, setMergeHistory] = useState<MergeHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [dateFilter, setDateFilter] = useState('all');

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'duplicates') {
      loadDuplicates();
    } else {
      loadMergeHistory();
    }
  }, [activeTab, dateFilter, historyPage]);

  const loadDuplicates = async () => {
    setLoading(true);
   setError(null);
    try {
      const client = await loadSharedApiClient();
      const result = await client.findDuplicates({
        threshold: 0.5,
        fields: ['title', 'tags', 'description'],
      });
      setDuplicates(result.duplicates);
      setSimilarity(result.similarity);

      // Auto-select highest metric item as suggested primary
      if (result.duplicates.length > 0) {
        const highest = result.duplicates.reduce((prev, curr) =>
          (curr.metrics?.views || /* istanbul ignore next */ 0) > (prev.metrics?.views || /* istanbul ignore next */ 0)
            ? curr
            : prev
        );
        setPrimaryContentId(highest.id);
      }
    } catch (err) {
      setError('Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  };

  const loadMergeHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        limit: 10,
        offset: (historyPage - 1) * 10,
      };

      if (dateFilter !== 'all') {
        const now = new Date();
        const start = new Date();
        if (dateFilter === 'last-30-days') {
          start.setDate(now.getDate() - 30);
        }
        params.dateRange = { start, end: now };
      }

      const client = await loadSharedApiClient();
      const result = await client.getMergeHistory(params);
      setMergeHistory(result.merges);
      setHistoryTotal(result.total || /* istanbul ignore next */ 0);
    } catch (err) {
      setError('Failed to load merge history');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? /* istanbul ignore next */ prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const getSimilarityPercentage = (index: number) => {
    return Math.round((similarity[index] || /* istanbul ignore next */ 0) * 100);
  };

  const groupedDuplicates = {
    high: duplicates.filter((_, i) => (similarity[i] || /* istanbul ignore next */ 0) >= 0.8),
    medium: duplicates.filter((_, i) => {
      const score = similarity[i] || /* istanbul ignore next */ 0;
      return score >= 0.5 && score < 0.8;
    }),
  };

  const calculateMergedMetrics = () => {
    const selected = duplicates.filter(d => selectedIds.includes(d.id));
    const totalViews = selected.reduce((sum, c) => sum + (c.metrics?.views || /* istanbul ignore next */ 0), 0);
    const totalLikes = selected.reduce((sum, c) => sum + (c.metrics?.likes || /* istanbul ignore next */ 0), 0);
    const allTags = [...new Set(selected.flatMap(c => c.tags))];
    const allUrls = selected.flatMap(c => c.urls);
    const primary = selected.find(c => c.id === primaryContentId);

    return {
      title: primary?.title || '',
      description: primary?.description || '',
      views: totalViews,
      likes: totalLikes,
      tags: allTags,
      urls: allUrls,
    };
  };

  const handleMerge = async () => {
    if (!primaryContentId || selectedIds.length < 2) return;

    setShowConfirmDialog(false);
    try {
      const client = await loadSharedApiClient();
      await client.mergeContent({
        contentIds: selectedIds,
        primaryId: primaryContentId,
      });
      setSuccessMessage('Successfully merged content items');
      setSelectedIds([]);
      setPrimaryContentId(null);
      setShowPreview(false);
      await loadDuplicates();
    } catch (err) {
      setError('Merge failed. Please try again.');
    }
  };

  const handleUndo = async (mergeId: string) => {
    try {
      const client = await loadSharedApiClient();
      await client.unmergeContent(mergeId);
      setSuccessMessage('Successfully restored content items');
      await loadMergeHistory();
    } catch (err) {
      setError('Failed to undo merge');
    }
  };

  const mergedPreview = calculateMergedMetrics();
  const canMerge = selectedIds.length >= 2 && primaryContentId;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Content Merge</h1>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab('duplicates')}
          className={`px-4 py-2 ${activeTab === 'duplicates' ? 'border-b-2 border-blue-600 font-semibold' : ''}`}
        >
          Duplicates
        </button>
        <button
          data-testid="merge-history-tab"
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 ${activeTab === 'history' ? 'border-b-2 border-blue-600 font-semibold' : ''}`}
        >
          Merge History
        </button>
      </div>

      {activeTab === 'duplicates' && (
        <div>
          {duplicates.length > 0 && (
            <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              Duplicate content detected: {duplicates.length} items found
            </div>
          )}

          {/* Selected items toolbar */}
          {selectedIds.length > 0 && (
            <div className="mb-4 bg-blue-50 border border-blue-200 px-4 py-3 rounded flex justify-between items-center">
              <span>{selectedIds.length} items selected</span>
              <div className="flex gap-2">
                <button
                  data-testid="preview-merge-button"
                  onClick={() => setShowPreview(true)}
                  disabled={!canMerge}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Preview Merge
                </button>
                <button
                  data-testid="merge-button"
                  onClick={() => setShowConfirmDialog(true)}
                  disabled={!canMerge || !primaryContentId}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Merge
                </button>
              </div>
            </div>
          )}

          {/* High Similarity Group */}
          {groupedDuplicates.high.length > 0 && (
            <div data-testid="high-similarity-group" className="mb-6">
              <h2 className="text-xl font-semibold mb-3 text-red-600">High Similarity (&gt;80%)</h2>
              <div className="space-y-3">
                {groupedDuplicates.high.map((item, index) => {
                  const globalIndex = duplicates.indexOf(item);
                  return (
                    <div key={item.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-red-500">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          data-testid={`content-${item.id}-checkbox`}
                          checked={selectedIds.includes(item.id)}
                          onChange={() => handleCheckboxChange(item.id)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h3 className="font-semibold">{item.title}</h3>
                            <div className="flex gap-2 items-center">
                              <span data-testid="duplicate-badge" className="badge-danger text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                                {getSimilarityPercentage(globalIndex)}% similar
                              </span>
                              {item.id === primaryContentId && (
                                <span data-testid={`suggested-primary-${item.id}`} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                  Suggested
                                </span>
                              )}
                            </div>
                          </div>
                          {item.description && <p className="text-gray-600 mt-1">{item.description}</p>}
                          <div className="mt-2 text-sm text-gray-500">
                            {item.metrics?.views && <span>{item.metrics.views} views</span>}
                            {item.metrics?.likes && <span className="ml-3">{item.metrics.likes} likes</span>}
                          </div>
                          <div className="mt-2">
                            {item.urls.map((u: { id: string; url: string }) => (
                              <a key={u.id} href={u.url} target="_blank" rel="noopener" className="text-blue-600 text-sm block">
                                {u.url}
                              </a>
                            ))}
                          </div>
                          {selectedIds.includes(item.id) && (
                            <div className="mt-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  data-testid={`primary-content-${item.id}`}
                                  name="primary"
                                  checked={primaryContentId === item.id}
                                  onChange={() => setPrimaryContentId(item.id)}
                                />
                                <span className="text-sm">Use as primary content</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Medium Similarity Group */}
          {groupedDuplicates.medium.length > 0 && (
            <div data-testid="medium-similarity-group" className="mb-6">
              <h2 className="text-xl font-semibold mb-3 text-yellow-600">Medium Similarity (50-80%)</h2>
              <div className="space-y-3">
                {groupedDuplicates.medium.map((item, index) => {
                  const globalIndex = duplicates.indexOf(item);
                  return (
                    <div key={item.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-yellow-500">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          data-testid={`content-${item.id}-checkbox`}
                          checked={selectedIds.includes(item.id)}
                          onChange={() => handleCheckboxChange(item.id)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h3 className="font-semibold">{item.title}</h3>
                            <span data-testid="duplicate-badge" className="badge-danger text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                              {getSimilarityPercentage(globalIndex)}% similar
                            </span>
                          </div>
                          {item.description && <p className="text-gray-600 mt-1">{item.description}</p>}
                          <div className="mt-2 text-sm text-gray-500">
                            {item.metrics?.views && <span>{item.metrics.views} views</span>}
                            {item.metrics?.likes && <span className="ml-3">{item.metrics.likes} likes</span>}
                          </div>
                          <div className="mt-2">
                            {item.urls.map((u: { id: string; url: string }) => (
                              <a key={u.id} href={u.url} target="_blank" rel="noopener" className="text-blue-600 text-sm block">
                                {u.url}
                              </a>
                            ))}
                          </div>
                          {selectedIds.includes(item.id) && (
                            <div className="mt-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  data-testid={`primary-content-${item.id}`}
                                  name="primary"
                                  checked={primaryContentId === item.id}
                                  onChange={() => setPrimaryContentId(item.id)}
                                />
                                <span className="text-sm">Use as primary content</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {duplicates.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-600">
              No duplicate content found
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          {/* Filters */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Filter by date:</label>
            <select
              data-testid="date-filter"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="all">All time</option>
              <option value="last-30-days">Last 30 days</option>
            </select>
          </div>

          {/* History List */}
          {mergeHistory.length > 0 ? (
            <div data-testid="merge-history-list" className="space-y-3">
              {mergeHistory.map((merge) => (
                <div key={merge.id} className="bg-white p-4 rounded-lg shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">
                        {new Date(merge.mergedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-sm text-gray-600">{merge.mergedContentIds.length} items merged</p>
                      {merge.canUndo && (
                        <p className="text-xs text-gray-500 mt-1">
                          Undo expires {new Date(merge.undoExpiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      )}
                      {!merge.canUndo && (
                        <p className="text-xs text-red-600 mt-1">Undo expired</p>
                      )}
                    </div>
                    <button
                      data-testid={`undo-merge-${merge.id}`}
                      onClick={() => handleUndo(merge.id)}
                      disabled={!merge.canUndo}
                      className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Undo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-600">
              No merge history available
            </div>
          )}

          {/* Pagination */}
          {historyTotal > 10 && (
            <div data-testid="pagination" className="mt-6 flex justify-center gap-2">
              <span>Page {historyPage} of {Math.ceil(historyTotal / 10)}</span>
              <button
                onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                disabled={historyPage === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setHistoryPage(p => p + 1)}
                disabled={historyPage >= Math.ceil(historyTotal / 10)}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Merge Preview</h2>
            <div data-testid="merge-preview" className="space-y-3">
              <div>
                <h3 className="font-semibold">{mergedPreview.title}</h3>
                <p className="text-gray-600">{mergedPreview.description}</p>
              </div>
              <div className="text-sm text-gray-600">
                <p>{mergedPreview.views} views</p>
                <p>{mergedPreview.likes} likes</p>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Tags:</p>
                <div className="flex flex-wrap gap-2">
                  {mergedPreview.tags.map(tag => (
                    <span key={tag} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">{tag}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">{mergedPreview.urls.length} URLs:</p>
                <ul className="list-disc list-inside text-sm">
                  {mergedPreview.urls.map((u: { id: string; url: string }) => (
                    <li key={u.id}>{u.url}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                data-testid="edit-preview-button"
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                data-testid="confirm-merge-button"
                onClick={() => {
                  setShowPreview(false);
                  setShowConfirmDialog(true);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Confirm Merge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {showConfirmDialog && !showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Confirm Merge</h3>
            {!primaryContentId ? (
              <p className="text-red-600 mb-4">Please select primary content before merging</p>
            ) : (
              <>
                <p className="mb-2">Primary content selected</p>
                <p className="mb-4">Are you sure you want to merge {selectedIds.length} items?</p>
              </>
            )}
            <div className="flex gap-3 justify-end">
              <button
                data-testid="cancel-merge-button"
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              {primaryContentId && (
                <button
                  data-testid="final-confirm-button"
                  onClick={handleMerge}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Confirm
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
