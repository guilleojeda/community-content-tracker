import { describe, expect, it } from '@jest/globals';
import { BadgeType, ChannelType, ConsentType, ContentType, Visibility } from '../types';

describe('shared enum types', () => {
  it('exposes stable enum values', () => {
    expect(Visibility.PRIVATE).toBe('private');
    expect(Visibility.AWS_ONLY).toBe('aws_only');
    expect(Visibility.AWS_COMMUNITY).toBe('aws_community');
    expect(Visibility.PUBLIC).toBe('public');

    expect(ContentType.BLOG).toBe('blog');
    expect(ContentType.YOUTUBE).toBe('youtube');
    expect(ContentType.GITHUB).toBe('github');
    expect(ContentType.CONFERENCE_TALK).toBe('conference_talk');

    expect(BadgeType.COMMUNITY_BUILDER).toBe('community_builder');
    expect(BadgeType.HERO).toBe('hero');
    expect(BadgeType.AMBASSADOR).toBe('ambassador');
    expect(BadgeType.USER_GROUP_LEADER).toBe('user_group_leader');

    expect(ChannelType.BLOG).toBe('blog');
    expect(ChannelType.YOUTUBE).toBe('youtube');
    expect(ChannelType.GITHUB).toBe('github');

    expect(ConsentType.ANALYTICS).toBe('analytics');
    expect(ConsentType.FUNCTIONAL).toBe('functional');
    expect(ConsentType.MARKETING).toBe('marketing');
  });
});
