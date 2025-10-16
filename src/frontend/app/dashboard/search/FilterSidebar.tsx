'use client';

import React from 'react';
import { BadgeType, ContentType, Visibility, SearchFilters } from '@shared/types';

interface FilterSidebarProps {
  filters: SearchFilters;
  onFilterChange: (filters: SearchFilters) => void;
  onClearFilters: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function FilterSidebar({
  filters,
  onFilterChange,
  onClearFilters,
  isOpen = true,
  onClose,
}: FilterSidebarProps) {
  const handleContentTypeToggle = (type: ContentType) => {
    const currentTypes = filters.contentTypes || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];

    onFilterChange({ ...filters, contentTypes: newTypes.length > 0 ? newTypes : undefined });
  };

  const handleBadgeToggle = (badge: BadgeType) => {
    const currentBadges = filters.badges || [];
    const newBadges = currentBadges.includes(badge)
      ? currentBadges.filter(b => b !== badge)
      : [...currentBadges, badge];

    onFilterChange({ ...filters, badges: newBadges.length > 0 ? newBadges : undefined });
  };

  const handleVisibilityToggle = (visibility: Visibility) => {
    const currentVisibility = filters.visibility || [];
    const newVisibility = currentVisibility.includes(visibility)
      ? currentVisibility.filter(v => v !== visibility)
      : [...currentVisibility, visibility];

    onFilterChange({ ...filters, visibility: newVisibility.length > 0 ? newVisibility : undefined });
  };

  const handleDateRangeChange = (start?: string, end?: string) => {
    /* istanbul ignore next */
    if (!start && !end) {
      const { dateRange, ...rest } = filters;
      onFilterChange(rest);
      return;
    }

    const dateRange = {
      start: start ? new Date(start) : filters.dateRange?.start || new Date(),
      end: end ? new Date(end) : filters.dateRange?.end || new Date(),
    };

    onFilterChange({ ...filters, dateRange });
  };

  const contentTypes = [
    { value: ContentType.BLOG, label: 'Blog' },
    { value: ContentType.YOUTUBE, label: 'YouTube' },
    { value: ContentType.GITHUB, label: 'GitHub' },
    { value: ContentType.CONFERENCE_TALK, label: 'Conference Talk' },
    { value: ContentType.PODCAST, label: 'Podcast' },
  ];

  const badges = [
    { value: BadgeType.HERO, label: 'Hero' },
    { value: BadgeType.COMMUNITY_BUILDER, label: 'Community Builder' },
    { value: BadgeType.AMBASSADOR, label: 'Ambassador' },
    { value: BadgeType.USER_GROUP_LEADER, label: 'User Group Leader' },
  ];

  const visibilityOptions = [
    { value: Visibility.PUBLIC, label: 'Public' },
    { value: Visibility.AWS_COMMUNITY, label: 'AWS Community' },
    { value: Visibility.AWS_ONLY, label: 'AWS Only' },
    { value: Visibility.PRIVATE, label: 'Private' },
  ];

  return (
    <aside
      className={`w-full lg:w-64 bg-white p-6 rounded-lg shadow ${isOpen ? 'block' : 'hidden lg:block'}`}
      data-testid="filter-sidebar"
    >
      {/* Mobile Close Button */}
      {onClose && (
        <button
          onClick={onClose}
          className="lg:hidden absolute top-4 right-4 text-gray-500 hover:text-gray-700"
          aria-label="Close filters"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-gray-900">Filters</h2>
        <button
          onClick={onClearFilters}
          className="text-sm text-blue-600 hover:text-blue-800"
          aria-label="Clear filters"
        >
          Clear Filters
        </button>
      </div>

      {/* Content Type Filter */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Content Type</h3>
        <div className="space-y-2">
          {contentTypes.map(({ value, label }) => (
            <label key={value} className="flex items-center">
              <input
                type="checkbox"
                checked={filters.contentTypes?.includes(value) || false}
                onChange={() => handleContentTypeToggle(value)}
                className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                aria-label={label}
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Badges Filter */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Badges</h3>
        <div className="space-y-2">
          {badges.map(({ value, label }) => (
            <label key={value} className="flex items-center">
              <input
                type="checkbox"
                checked={filters.badges?.includes(value) || false}
                onChange={() => handleBadgeToggle(value)}
                className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                aria-label={label}
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Visibility Filter */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Visibility</h3>
        <div className="space-y-2">
          {visibilityOptions.map(({ value, label }) => (
            <label key={value} className="flex items-center">
              <input
                type="checkbox"
                checked={filters.visibility?.includes(value) || false}
                onChange={() => handleVisibilityToggle(value)}
                className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                aria-label={label}
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Date Range</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="from-date" className="block text-sm text-gray-700 mb-1">
              From Date
            </label>
            <input
              id="from-date"
              type="date"
              value={filters.dateRange?.start ? filters.dateRange.start.toISOString().split('T')[0] : ''}
              onChange={(e) => handleDateRangeChange(e.target.value, filters.dateRange?.end ? filters.dateRange.end.toISOString().split('T')[0] : undefined)}
              className="input-field w-full"
              aria-label="From date"
            />
          </div>
          <div>
            <label htmlFor="to-date" className="block text-sm text-gray-700 mb-1">
              To Date
            </label>
            <input
              id="to-date"
              type="date"
              value={filters.dateRange?.end ? filters.dateRange.end.toISOString().split('T')[0] : ''}
              onChange={(e) => handleDateRangeChange(filters.dateRange?.start ? filters.dateRange.start.toISOString().split('T')[0] : undefined, e.target.value)}
              className="input-field w-full"
              aria-label="To date"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
