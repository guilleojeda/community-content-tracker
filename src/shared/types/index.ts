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
    PODCAST = 'podcast',
    SOCIAL = 'social',
    WHITEPAPER = 'whitepaper',
    TUTORIAL = 'tutorial',
    WORKSHOP = 'workshop',
    BOOK = 'book'
  }
  
  export enum BadgeType {
    COMMUNITY_BUILDER = 'community_builder',
    HERO = 'hero',
    AMBASSADOR = 'ambassador',
    USER_GROUP_LEADER = 'user_group_leader'
  }
  
  // Social Links Interface
  export interface SocialLinks {
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  }

  // Entity Interfaces
  export interface User {
    id: string;
    cognitoSub: string;
    email: string;
    username: string;
    profileSlug: string;
    bio?: string;
    socialLinks?: SocialLinks;
    defaultVisibility: Visibility;
    isAdmin: boolean;
    isAwsEmployee: boolean;
    mfaEnabled?: boolean;
    receiveNewsletter?: boolean;
    receiveContentNotifications?: boolean;
    receiveCommunityUpdates?: boolean;
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
    deletedAt?: Date;
    version: number;
  }

export interface Badge {
    id: string;
    userId: string;
    badgeType: BadgeType;
    awardedAt: Date;
    awardedBy?: string;
    awardedReason?: string;
    metadata?: Record<string, any>;
    isActive?: boolean;
    revokedAt?: Date;
    revokedBy?: string;
    revokeReason?: string;
    createdAt: Date;
    updatedAt: Date;
  }
  
  // Content API Request/Response Types
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

  // Authentication API Types
  export interface RegisterRequest {
    email: string;
    password: string;
    username: string;
  }

  export interface RegisterResponse {
    userId: string;
    message: string;
  }

  export interface LoginRequest {
    email: string;
    password: string;
  }

  export interface LoginResponse {
    accessToken: string;
    idToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
      id: string;
      email: string;
      username: string;
      profileSlug: string;
      isAdmin: boolean;
      isAwsEmployee: boolean;
    };
  }

  export interface RefreshTokenRequest {
    refreshToken: string;
  }

  export interface RefreshTokenResponse {
    accessToken: string;
    idToken?: string; // Optional - not always returned by Cognito on refresh
    expiresIn: number;
  }

  export interface VerifyEmailRequest {
    email: string;
    confirmationCode: string;
  }

  export interface VerifyEmailResponse {
    message: string;
    verified: boolean;
  }

  export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, any>;
  }

  export interface ApiErrorResponse {
    error: ApiError;
  }

  // Channel Types
export enum ChannelType {
  BLOG = 'blog',
  YOUTUBE = 'youtube',
  GITHUB = 'github'
}

export enum ConsentType {
  ANALYTICS = 'analytics',
  FUNCTIONAL = 'functional',
  MARKETING = 'marketing'
}

  export interface Channel {
    id: string;
    userId: string;
    channelType: ChannelType;
    url: string;
    name?: string;
    enabled: boolean;
    lastSyncAt?: Date;
    lastSyncStatus?: 'success' | 'error';
    lastSyncError?: string;
    syncFrequency: 'daily' | 'weekly' | 'manual';
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface CreateChannelRequest {
    channelType: ChannelType;
    url: string;
    name?: string;
    syncFrequency?: 'daily' | 'weekly' | 'manual';
    metadata?: Record<string, any>;
  }

  export interface UpdateChannelRequest {
    name?: string;
    enabled?: boolean;
    syncFrequency?: 'daily' | 'weekly' | 'manual';
    metadata?: Record<string, any>;
  }

export interface ChannelListResponse {
  channels: Channel[];
  total: number;
}

export interface ContentBookmark {
  id: string;
  userId: string;
  contentId: string;
  createdAt: Date;
}

export interface UserFollowEdge {
  followerId: string;
  followingId: string;
  createdAt: Date;
}

export interface UserConsentRecord {
  id: string;
  consentType: ConsentType;
  granted: boolean;
  consentVersion: string;
  grantedAt?: Date;
  revokedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

  export interface TriggerSyncRequest {
    channelId: string;
  }

  export interface TriggerSyncResponse {
    message: string;
    syncJobId: string;
  }

  // Scraper Message Types
  export interface ScraperMessage {
    channelId: string;
    userId: string;
    channelType: ChannelType;
    url: string;
    lastSyncAt?: string;
    metadata?: Record<string, any>;
  }

  export interface ContentProcessorMessage {
    userId: string;
    channelId: string;
    title: string;
    description?: string;
    contentType: ContentType;
    url: string;
    publishDate?: string;
    metadata?: Record<string, any>;
  }

  // User Settings API Types
export interface UpdateUserRequest {
  email?: string;
  username?: string;
  bio?: string;
  defaultVisibility?: Visibility;
  socialLinks?: SocialLinks;
}

  export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
  }

  export interface ChangePasswordResponse {
    message: string;
  }

  export interface MfaSetupResponse {
    qrCode: string;
    secret: string;
  }

  export interface UpdatePreferencesRequest {
    receiveNewsletter?: boolean;
    receiveContentNotifications?: boolean;
    receiveCommunityUpdates?: boolean;
  }

  export interface UpdatePreferencesResponse {
    message: string;
  }

export interface UserDataExport {
  user: User;
  content: Content[];
  badges: Badge[];
  channels: Channel[];
  bookmarks: ContentBookmark[];
  follows: {
    following: UserFollowEdge[];
    followers: UserFollowEdge[];
  };
  consents: UserConsentRecord[];
  exportDate: string;
}

  export interface DeleteAccountResponse {
    message: string;
  }

  // Search Filters Interface (matches SearchRequest.filters structure)
  export interface SearchFilters {
    contentTypes?: ContentType[];
    badges?: BadgeType[];
    visibility?: Visibility[];
    dateRange?: { start: Date; end: Date };
    tags?: string[];
  }

  export interface PlatformStats {
    totalUsers: number;
    totalContent: number;
    topContributors: number;
    contentByType: Record<string, number>;
    recentActivity: {
      last24h: number;
      last7d: number;
      last30d: number;
    };
    uptime: string;
    lastUpdated: string;
  }

  // Admin Dashboard Types (Sprint 7 - Task 7.1)
  export interface RecentRegistration {
    id: string;
    username: string;
    email: string;
    createdAt: Date;
  }

  export interface PendingBadgeCandidate {
    id: string;
    username: string;
    email: string;
    contentCount: number;
    createdAt: Date;
  }

  export interface QuickActions {
    flaggedContentCount: number;
    recentAdminActions: number;
    usersWithoutBadges: number;
    contentNeedingReview: number;
  }

  export interface AdminDashboardStats {
    totalUsers: number;
    awsEmployees: number;
    usersByBadgeType: Record<BadgeType, number>;
    totalContent: number;
    recentRegistrations: RecentRegistration[];
    pendingBadgeCandidates: PendingBadgeCandidate[];
    quickActions: QuickActions;
  }

  export interface ConnectionPoolMetrics {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingConnections: number;
  }

  export interface SystemHealthStatus {
    database: 'healthy' | 'unhealthy';
    connectionPool?: ConnectionPoolMetrics;
    queryPerformance?: {
      lastQueryMs: number;
      avgQueryMs?: number;
    };
    lambda?: {
      memoryUsedMB: number;
      memoryLimitMB: number;
    };
    timestamp: string;
    error?: string;
  }

  export type ExportHistoryType = 'program' | 'analytics' | 'user_list';

  export interface ExportHistoryEntry {
    id: string;
    exportType: ExportHistoryType;
    exportFormat: string | null;
    rowCount: number | null;
    createdAt: Date;
    parameters: {
      programType?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      groupBy?: string | null;
    };
  }

  export interface ExportHistoryResponse {
    history: ExportHistoryEntry[];
    total: number;
    limit: number;
    offset: number;
  }
