/**
 * UI Constants - Shared display values, colors, and labels
 * Used across components for consistent theming and labeling
 */

import { BadgeType, ContentType, Visibility } from '@shared/types';

// ============================================
// Visibility Colors
// ============================================

/**
 * Color mappings for visibility levels
 * Used in charts and visualization components
 */
export const VISIBILITY_COLORS: Record<Visibility, string> = {
  [Visibility.PUBLIC]: '#10b981', // green
  [Visibility.AWS_COMMUNITY]: '#3b82f6', // blue
  [Visibility.AWS_ONLY]: '#8b5cf6', // purple
  [Visibility.PRIVATE]: '#6b7280', // gray
};

/**
 * Tailwind CSS class names for visibility badges
 */
export const VISIBILITY_BADGE_CLASSES: Record<Visibility, string> = {
  [Visibility.PUBLIC]: 'bg-green-100 text-green-800',
  [Visibility.AWS_COMMUNITY]: 'bg-blue-100 text-blue-800',
  [Visibility.AWS_ONLY]: 'bg-purple-100 text-purple-800',
  [Visibility.PRIVATE]: 'bg-gray-100 text-gray-800',
};

// ============================================
// Badge Type Labels and Colors
// ============================================

/**
 * Display labels for AWS program badge types
 */
export const BADGE_TYPE_LABELS: Record<BadgeType, string> = {
  [BadgeType.HERO]: 'AWS Hero',
  [BadgeType.COMMUNITY_BUILDER]: 'Community Builder',
  [BadgeType.AMBASSADOR]: 'AWS Ambassador',
  [BadgeType.USER_GROUP_LEADER]: 'User Group Leader',
};

/**
 * Tailwind CSS background color classes for badge types
 */
export const BADGE_TYPE_COLORS: Record<BadgeType, string> = {
  [BadgeType.HERO]: 'bg-purple-600',
  [BadgeType.COMMUNITY_BUILDER]: 'bg-blue-600',
  [BadgeType.AMBASSADOR]: 'bg-green-600',
  [BadgeType.USER_GROUP_LEADER]: 'bg-orange-600',
};

/**
 * Tailwind CSS class names for badge type badges (with background and text)
 */
export const BADGE_TYPE_BADGE_CLASSES: Record<BadgeType, string> = {
  [BadgeType.HERO]: 'bg-purple-100 text-purple-800',
  [BadgeType.COMMUNITY_BUILDER]: 'bg-blue-100 text-blue-800',
  [BadgeType.AMBASSADOR]: 'bg-green-100 text-green-800',
  [BadgeType.USER_GROUP_LEADER]: 'bg-orange-100 text-orange-800',
};

// ============================================
// Content Type Labels
// ============================================

/**
 * Display labels for content types
 */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  [ContentType.BLOG]: 'Blog Post',
  [ContentType.YOUTUBE]: 'YouTube Video',
  [ContentType.GITHUB]: 'GitHub Repository',
  [ContentType.CONFERENCE_TALK]: 'Conference Talk',
  [ContentType.PODCAST]: 'Podcast Episode',
  [ContentType.SOCIAL]: 'Social Media Post',
  [ContentType.WHITEPAPER]: 'Whitepaper',
  [ContentType.TUTORIAL]: 'Tutorial',
  [ContentType.WORKSHOP]: 'Workshop',
  [ContentType.BOOK]: 'Book',
};

/**
 * Tailwind CSS class names for content type badges
 */
export const CONTENT_TYPE_BADGE_CLASSES: Record<ContentType, string> = {
  [ContentType.BLOG]: 'bg-blue-100 text-blue-800',
  [ContentType.YOUTUBE]: 'bg-red-100 text-red-800',
  [ContentType.GITHUB]: 'bg-gray-100 text-gray-800',
  [ContentType.CONFERENCE_TALK]: 'bg-purple-100 text-purple-800',
  [ContentType.PODCAST]: 'bg-green-100 text-green-800',
  [ContentType.SOCIAL]: 'bg-cyan-100 text-cyan-800',
  [ContentType.WHITEPAPER]: 'bg-indigo-100 text-indigo-800',
  [ContentType.TUTORIAL]: 'bg-amber-100 text-amber-800',
  [ContentType.WORKSHOP]: 'bg-pink-100 text-pink-800',
  [ContentType.BOOK]: 'bg-teal-100 text-teal-800',
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get display label for a badge type
 */
export function getBadgeLabel(badgeType: BadgeType): string {
  return BADGE_TYPE_LABELS[badgeType] || badgeType;
}

/**
 * Get Tailwind color class for a badge type
 */
export function getBadgeColor(badgeType: BadgeType): string {
  return BADGE_TYPE_COLORS[badgeType] || 'bg-gray-600';
}

/**
 * Get Tailwind badge class for a badge type
 */
export function getBadgeBadgeClass(badgeType: BadgeType): string {
  return BADGE_TYPE_BADGE_CLASSES[badgeType] || 'bg-gray-100 text-gray-800';
}

/**
 * Get display label for a content type
 */
export function getContentTypeLabel(contentType: ContentType): string {
  return CONTENT_TYPE_LABELS[contentType] || contentType;
}

/**
 * Get Tailwind badge class for a content type
 */
export function getContentTypeBadgeClass(contentType: ContentType): string {
  return CONTENT_TYPE_BADGE_CLASSES[contentType] || 'bg-gray-100 text-gray-800';
}

/**
 * Get visibility color (hex) for charts
 */
export function getVisibilityColor(visibility: Visibility): string {
  return VISIBILITY_COLORS[visibility] || '#6b7280';
}

/**
 * Get Tailwind badge class for visibility
 */
export function getVisibilityBadgeClass(visibility: Visibility): string {
  return VISIBILITY_BADGE_CLASSES[visibility] || 'bg-gray-100 text-gray-800';
}
