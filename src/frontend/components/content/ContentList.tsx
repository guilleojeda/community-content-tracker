/**
 * ContentList Component
 * Displays list of content items with selection and actions
 */

'use client';

import React from 'react';
import { Content, ContentType, Visibility } from '../../../shared/types';

interface ContentListProps {
  content: Content[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onEdit: (content: Content) => void;
  onDelete: (content: Content) => void;
  onPreview: (content: Content) => void;
}

export default function ContentList({
  content,
  selectedIds,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  onPreview,
}: ContentListProps) {
  const allSelected = content.length > 0 && selectedIds.length === content.length;

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getVisibilityBadge = (visibility: Visibility) => {
    const badges = {
      [Visibility.PUBLIC]: 'bg-green-100 text-green-800',
      [Visibility.AWS_COMMUNITY]: 'bg-blue-100 text-blue-800',
      [Visibility.AWS_ONLY]: 'bg-purple-100 text-purple-800',
      [Visibility.PRIVATE]: 'bg-gray-100 text-gray-800',
    };
    return badges[visibility] || badges[Visibility.PRIVATE];
  };

  const getContentTypeIcon = (type: ContentType) => {
    switch (type) {
      case ContentType.BLOG:
        return '[Blog]';
      case ContentType.YOUTUBE:
        return '[Video]';
      case ContentType.GITHUB:
        return '[Code]';
      case ContentType.CONFERENCE_TALK:
        return '[Talk]';
      case ContentType.PODCAST:
        return '[Audio]';
      default:
        return '[Doc]';
    }
  };

  if (content.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">No content found</p>
        <p className="text-gray-400 mt-2">Add your first content to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-4 pb-4 border-b">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onSelectAll}
          aria-label="Select all"
          className="w-4 h-4 rounded border-gray-300"
        />
        <span className="text-sm text-gray-600">
          {selectedIds.length > 0 ? `${selectedIds.length} items selected` : 'Select all'}
        </span>
      </div>

      {content.map((item) => (
        <article
          key={item.id}
          className="border rounded-lg p-6 hover:shadow-md transition-shadow bg-white"
        >
          <div className="flex items-start gap-4">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => onSelect(item.id)}
              aria-label="Select content"
              className="mt-1 w-4 h-4 rounded border-gray-300"
            />

            <div className="flex-1">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {getContentTypeIcon(item.contentType)} {item.title}
                  </h3>
                  {item.description && (
                    <p className="text-gray-600 mb-3">{item.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getVisibilityBadge(item.visibility)}`}>
                      {item.visibility.replace('_', ' ')}
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {item.contentType}
                    </span>
                  </div>

                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-sm text-gray-500">
                    {item.publishDate && (
                      <span className="mr-4">
                        Published: {formatDate(item.publishDate)}
                      </span>
                    )}
                    <span>Updated: {formatDate(item.updatedAt)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onPreview(item)}
                    className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => onEdit(item)}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(item)}
                    className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
