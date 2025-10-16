import {
  BADGE_TYPE_BADGE_CLASSES,
  BADGE_TYPE_COLORS,
  BADGE_TYPE_LABELS,
  CONTENT_TYPE_BADGE_CLASSES,
  CONTENT_TYPE_LABELS,
  VISIBILITY_BADGE_CLASSES,
  VISIBILITY_COLORS,
  getBadgeBadgeClass,
  getBadgeColor,
  getBadgeLabel,
  getContentTypeBadgeClass,
  getContentTypeLabel,
  getVisibilityBadgeClass,
  getVisibilityColor,
} from '@/lib/constants/ui';
import { BadgeType, ContentType, Visibility } from '@shared/types';

describe('UI constants helpers', () => {
  it('returns friendly badge labels and fallbacks', () => {
    expect(getBadgeLabel(BadgeType.HERO)).toBe(BADGE_TYPE_LABELS[BadgeType.HERO]);
    expect(getBadgeLabel('unknown' as BadgeType)).toBe('unknown');
  });

  it('returns badge background colors with fallback', () => {
    expect(getBadgeColor(BadgeType.AMBASSADOR)).toBe(BADGE_TYPE_COLORS[BadgeType.AMBASSADOR]);
    expect(getBadgeColor('mystery' as BadgeType)).toBe('bg-gray-600');
  });

  it('returns badge class styling with fallback', () => {
    expect(getBadgeBadgeClass(BadgeType.USER_GROUP_LEADER)).toBe(
      BADGE_TYPE_BADGE_CLASSES[BadgeType.USER_GROUP_LEADER]
    );
    expect(getBadgeBadgeClass('mystery' as BadgeType)).toBe('bg-gray-100 text-gray-800');
  });

  it('maps content types to labels and badge classes', () => {
    expect(getContentTypeLabel(ContentType.YOUTUBE)).toBe(CONTENT_TYPE_LABELS[ContentType.YOUTUBE]);
    expect(getContentTypeLabel('custom' as ContentType)).toBe('custom');

    expect(getContentTypeBadgeClass(ContentType.GITHUB)).toBe(
      CONTENT_TYPE_BADGE_CLASSES[ContentType.GITHUB]
    );
    expect(getContentTypeBadgeClass('custom' as ContentType)).toBe('bg-gray-100 text-gray-800');
  });

  it('returns visibility colors and badge classes', () => {
    expect(getVisibilityColor(Visibility.PUBLIC)).toBe(VISIBILITY_COLORS[Visibility.PUBLIC]);
    expect(getVisibilityColor('secret' as Visibility)).toBe('#6b7280');

    expect(getVisibilityBadgeClass(Visibility.AWS_ONLY)).toBe(
      VISIBILITY_BADGE_CLASSES[Visibility.AWS_ONLY]
    );
    expect(getVisibilityBadgeClass('secret' as Visibility)).toBe('bg-gray-100 text-gray-800');
  });
});
