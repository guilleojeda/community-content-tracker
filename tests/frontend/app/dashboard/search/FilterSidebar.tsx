'use client';

import React, { useState, useEffect } from 'react';
import { BadgeType, ContentType, Visibility } from '@shared/types';

interface SearchFilters {
  contentTypes?: ContentType[];
  badges?: BadgeType[];
  visibility?: Visibility[];
  dateRange?: { start: Date; end: Date };
  tags?: string[];
}

interface FilterSidebarProps {
  filters: SearchFilters;
  onFilterChange: (newFilters: SearchFilters) => void;
  onClearFilters: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function FilterSidebar({
  filters,
  onFilterChange,
  onClearFilters,
  isOpen,
  onClose,
}: FilterSidebarProps) {
  const [localFilters, setLocalFilters] = useState<SearchFilters>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleContentTypeChange = (type: ContentType, checked: boolean) => {
    const newTypes = checked
      ? [...(localFilters.contentTypes || []), type]
      : (localFilters.contentTypes || []).filter((t) => t !== type);

    const newFilters = { ...localFilters, contentTypes: newTypes.length > 0 ? newTypes : undefined };
    setLocalFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleBadgeChange = (badge: BadgeType, checked: boolean) => {
    const newBadges = checked
      ? [...(localFilters.badges || []), badge]
      : (localFilters.badges || []).filter((b) => b !== badge);

    const newFilters = { ...localFilters, badges: newBadges.length > 0 ? newBadges : undefined };
    setLocalFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleVisibilityChange = (visibility: Visibility, checked: boolean) => {
    const newVisibility = checked
      ? [...(localFilters.visibility || []), visibility]
      : (localFilters.visibility || []).filter((v) => v !== visibility);

    const newFilters = { ...localFilters, visibility: newVisibility.length > 0 ? newVisibility : undefined };
    setLocalFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleDateRangeChange = (field: 'start' | 'end', value: string) => {
    const date = value ? new Date(value) : undefined;
    const newDateRange = {
      ...(localFilters.dateRange || {}),
      [field]: date,
    };

    const hasValidRange = newDateRange.start || newDateRange.end;
    const newFilters = {
      ...localFilters,
      dateRange: hasValidRange ? (newDateRange as { start: Date; end: Date }) : undefined,
    };

    setLocalFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const tagsInput = e.target.value;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const newFilters = { ...localFilters, tags: tags.length > 0 ? tags : undefined };
    setLocalFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleClear = () => {
    setLocalFilters({});
    onClearFilters();
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm p-6 w-full lg:w-64 ${isOpen ? 'block' : 'hidden'} lg:block`}>
      <div className="lg:hidden mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close filters">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="hidden lg:block mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Content Type</h3>
          <div className="space-y-2">
            {Object.values(ContentType).map((type) => (
              <label key={type} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localFilters.contentTypes?.includes(type) || false}
                  onChange={(e) => handleContentTypeChange(type, e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 capitalize">{type.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Creator Badges</h3>
          <div className="space-y-2">
            {Object.values(BadgeType).map((badge) => (
              <label key={badge} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localFilters.badges?.includes(badge) || false}
                  onChange={(e) => handleBadgeChange(badge, e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 capitalize">{badge.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Visibility</h3>
          <div className="space-y-2">
            {Object.values(Visibility).map((vis) => (
              <label key={vis} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localFilters.visibility?.includes(vis) || false}
                  onChange={(e) => handleVisibilityChange(vis, e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 capitalize">{vis}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Date Range</h3>
          <div className="space-y-2">
            <div>
              <label htmlFor="date-start" className="block text-xs text-gray-600 mb-1">
                From
              </label>
              <input
                id="date-start"
                type="date"
                value={localFilters.dateRange?.start ? localFilters.dateRange.start.toISOString().split('T')[0] : ''}
                onChange={(e) => handleDateRangeChange('start', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="date-end" className="block text-xs text-gray-600 mb-1">
                To
              </label>
              <input
                id="date-end"
                type="date"
                value={localFilters.dateRange?.end ? localFilters.dateRange.end.toISOString().split('T')[0] : ''}
                onChange={(e) => handleDateRangeChange('end', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Tags</h3>
          <input
            type="text"
            value={(localFilters.tags || []).join(', ')}
            onChange={handleTagsChange}
            placeholder="Enter tags (comma-separated)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">Separate multiple tags with commas</p>
        </div>

        <button
          onClick={handleClear}
          className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );
}
