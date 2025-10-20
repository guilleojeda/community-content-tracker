/**
 * API client exports
 */

export {
  ApiClient,
  createApiClient,
  getAuthenticatedApiClient,
  getPublicApiClient,
  apiClient,
} from './client';
export type {
  ApiClientConfig,
  ApiError,
  ApiErrorResponse,
  AdminDashboardStats,
  AdminDashboardQuickActions,
  AdminUserListResponse,
  AdminUserSummary,
  AdminUserDetail,
  AdminBulkBadgeResult,
  AuditLogEntry,
  AuditLogResponse,
  FlaggedContentItem,
  FlaggedContentResponse,
  UserAnalyticsData,
  SavedSearchEntry,
  SavedSearchListResponse,
  AdvancedSearchResponse,
  AdvancedSearchResultItem,
  AnalyticsEventInput,
  CsvDownload,
  ExportHistoryEntry,
  ExportHistoryResponse,
} from './client';
export type { paths, components } from './schema';
