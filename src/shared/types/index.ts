// Core Enums (must match database exactly)
export enum Visibility {
    PRIVATE = 'private',
    AWS_ONLY = 'aws_only',
    AWS_COMMUNITY = 'aws_community',
    PUBLIC = 'public'
  }
  
  export enum ContentType {
    BLOG = 'blog',
    YOUTUBE = 'youtube',
    GITHUB = 'github',
    CONFERENCE_TALK = 'conference_talk',
    PODCAST = 'podcast'
  }
  
  export enum BadgeType {
    COMMUNITY_BUILDER = 'community_builder',
    HERO = 'hero',
    AMBASSADOR = 'ambassador',
    USER_GROUP_LEADER = 'user_group_leader'
  }
  
  // Entity Interfaces
  export interface User {
    id: string;
    cognitoSub: string;
    email: string;
    username: string;
    profileSlug: string;
    defaultVisibility: Visibility;
    isAdmin: boolean;
    isAwsEmployee: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface ContentUrl {
    id: string;
    url: string;
  }
  
  export interface Content {
    id: string;
    userId: string;
    title: string;
    description?: string;
    contentType: ContentType;
    visibility: Visibility;
    publishDate?: Date;
    captureDate: Date;
    metrics: Record<string, any>;
    tags: string[];
    embedding?: number[];
    isClaimed: boolean;
    originalAuthor?: string;
    urls: ContentUrl[];
    createdAt: Date;
    updatedAt: Date;
  }
  
  // API Request/Response Types
  export interface CreateContentRequest {
    title: string;
    description?: string;
    contentType: ContentType;
    visibility?: Visibility;
    urls: string[];
    tags?: string[];
    publishDate?: string;
    isClaimed?: boolean;
    originalAuthor?: string;
  }
  
  export interface SearchRequest {
    query: string;
    filters?: {
      badges?: BadgeType[];
      contentTypes?: ContentType[];
      dateRange?: { start: Date; end: Date };
      tags?: string[];
      visibility?: Visibility[];
    };
    limit?: number;
    offset?: number;
  }