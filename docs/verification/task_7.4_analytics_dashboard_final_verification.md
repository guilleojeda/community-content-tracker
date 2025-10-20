# Task 7.4: Analytics Dashboard - Comprehensive Verification Report

**Verification Date:** 2025-10-18
**Task:** Task 7.4 - Analytics Dashboard (Sprint 7)
**Story Points:** 8
**Reviewer:** Code Review Agent

---

## Executive Summary

**OVERALL STATUS: ⚠️ PARTIAL PASS**

Task 7.4 has been implemented with real, functional analytics dashboard features including time series charts, pie charts, bar charts, date range filtering, and CSV export capabilities. However, **critical test coverage gaps exist** - there are **NO frontend tests** for the analytics dashboard page, which is a significant oversight for a user-facing feature.

**Score: 75/100**
- ✅ Backend Implementation: Complete (100%)
- ✅ Frontend Implementation: Complete (100%)
- ❌ Test Coverage: Incomplete (25% - backend only, no frontend tests)
- ✅ Requirements Met: 7/7 acceptance criteria (100%)

---

## Acceptance Criteria Verification

### ✅ 1. Time Series Charts (Views Over Time)
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 229-254)
- Uses Recharts `<LineChart>` component with real data
- Displays views over time from `analytics_events` table
- Supports grouping by day/week/month via `DATE_TRUNC` SQL function
- X-axis formatted with dates, Y-axis shows view counts
- Data source: `timeSeries` from backend aggregation

**Backend Data:**
```typescript
// src/backend/lambdas/analytics/user-analytics.ts (lines 111-123)
const timeSeriesQuery = `
  SELECT DATE_TRUNC('${groupBy}', created_at) as date, COUNT(*) as views
  FROM analytics_events
  WHERE user_id = $1 AND event_type = 'content_view' ${timeSeriesFilter}
  GROUP BY date
  ORDER BY date
`;
```

**Evidence:**
- Real Recharts component: `<LineChart>`, `<Line>`, `<CartesianGrid>`, `<XAxis>`, `<YAxis>`, `<Tooltip>`
- Not placeholder data - queries actual analytics_events table
- Responsive via `<ResponsiveContainer width="100%" height="100%">`

---

### ✅ 2. Topic Distribution Pie Chart
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 278-309)
- Uses Recharts `<PieChart>` and `<Pie>` components
- Displays top 10 tags from content
- Color-coded cells using `CHART_COLORS` array (6 colors)
- Includes labels and legend

**Backend Data:**
```typescript
// src/backend/lambdas/analytics/user-analytics.ts (lines 74-88)
const topTagsQuery = `
  SELECT UNNEST(tags) as tag, COUNT(*) as count
  FROM content
  WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
  GROUP BY tag
  ORDER BY count DESC
  LIMIT 10
`;
```

**Evidence:**
- Real Recharts `<PieChart>` with `<Pie>` component
- Dynamic data from database aggregation
- Color cells mapped to indices: `CHART_COLORS[index % CHART_COLORS.length]`

---

### ✅ 3. Channel Performance Comparison
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 255-276)
- Uses Recharts `<BarChart>` component
- Displays content distribution by type (blog, youtube, tweet, etc.)
- Y-axis shows count of content items per type
- X-axis formatted to replace underscores with spaces

**Backend Data:**
```typescript
// src/backend/lambdas/analytics/user-analytics.ts (lines 60-72)
const contentByTypeQuery = `
  SELECT content_type, COUNT(*) as count
  FROM content
  WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
  GROUP BY content_type
`;
```

**Evidence:**
- Real Recharts `<BarChart>` with `<Bar>` component
- Data aggregation from content table grouping by content_type
- Responsive container

---

### ✅ 4. Top Performing Content List
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 310-329)
- Displays top 10 content items ranked by views
- Shows title, content type, and view count
- Formatted view counts with `toLocaleString()`

**Backend Data:**
```typescript
// src/backend/lambdas/analytics/user-analytics.ts (lines 90-105)
const topContentQuery = `
  SELECT id, title, content_type, (metrics->>'views')::int as views
  FROM content
  WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
  ORDER BY (metrics->>'views')::int DESC NULLS LAST
  LIMIT 10
`;
```

**Evidence:**
- Real data from content metrics JSON field
- Proper handling of NULL views with `NULLS LAST`
- Displays actual content titles and view counts

---

### ✅ 5. Date Range Selector
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 138-205)
- Start Date and End Date inputs (HTML5 `<input type="date">`)
- Group By selector: Day, Week, Month
- Apply button to reload with filters
- Clear button to reset filters

**Backend Support:**
```typescript
// src/backend/lambdas/analytics/user-analytics.ts (lines 51-58)
let dateFilter = '';
const values: any[] = [userId];

if (startDate && endDate) {
  dateFilter = ' AND publish_date BETWEEN $2 AND $3';
  values.push(startDate, endDate);
}
```

**Evidence:**
- State management: `filters.startDate`, `filters.endDate`, `filters.groupBy`
- Parameterized SQL prevents injection
- Applied to all 4 analytics queries (contentByType, topTags, topContent, timeSeries)

---

### ✅ 6. Export to CSV Option
**STATUS: PASS**

**Implementation:**
- Location: `src/frontend/app/dashboard/analytics/page.tsx` (lines 331-395)
- Two export types:
  1. **Analytics Export**: General analytics data with date filters
  2. **Program Export**: AWS program-specific formats (Community Builders, Heroes, Ambassadors, User Group Leaders)

**Analytics Export Backend:**
- File: `src/backend/lambdas/analytics/export-analytics.ts`
- Generates CSV: Date, ContentType, Title, Views, Likes, Comments
- Tests: `tests/backend/lambdas/analytics/export-analytics.test.ts` (216 lines)
- Covers: CSV generation, date filtering, field escaping, null handling

**Program Export Backend:**
- File: `src/backend/lambdas/export/csv-export.ts`
- Four formats:
  - Community Builder: Title, URL, PublishDate, ContentType
  - Hero: + Views, Likes (metrics)
  - Ambassador: + Tags
  - User Group Leader: + EventDate
- Tests: `tests/backend/lambdas/export/csv-export.test.ts`
- Analytics event logging for audit trail

**Frontend Integration:**
```typescript
// Uses downloadBlob utility (src/frontend/src/utils/download.ts)
async handleExportAnalytics() {
  const download = await apiClient.exportAnalyticsCsv(filters);
  triggerDownload(download, 'analytics-export.csv');
}

async handleProgramExport() {
  const download = await apiClient.exportProgramCsv({
    programType: exportProgram,
    startDate: exportRange.startDate,
    endDate: exportRange.endDate,
  });
  triggerDownload(download, `${exportProgram}-export.csv`);
}
```

**Evidence:**
- Real CSV generation with proper escaping
- Content-Disposition header for file download
- Comprehensive backend tests (CSV escaping, date filtering, authentication)

---

### ✅ 7. Responsive Charts
**STATUS: PASS**

**Implementation:**
- All charts wrapped in `<ResponsiveContainer width="100%" height="100%">`
- Grid layout with responsive classes:
  - `grid gap-6 lg:grid-cols-2` - 2 columns on large screens, 1 column on mobile
  - `grid gap-4 md:grid-cols-2` - Responsive export section
  - `mt-4 h-64` - Fixed height containers for charts
- Chart containers: 256px height (h-64 class)

**Responsive Classes Used:**
```tsx
<section className="grid gap-6 lg:grid-cols-2">  // 2-col layout on desktop
<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
  <div className="mt-4 h-64">  // Fixed height for charts
    <ResponsiveContainer width="100%" height="100%">
      {/* Chart components */}
    </ResponsiveContainer>
  </div>
</div>
</section>
```

**Evidence:**
- Recharts ResponsiveContainer handles dynamic resizing
- Tailwind responsive classes: `lg:`, `md:` breakpoints
- Mobile-friendly: single column layout on small screens

---

## Implementation Assessment

### Frontend Implementation (412 lines)
**GRADE: A (95/100)**

**Strengths:**
✅ Real charting library (Recharts) with actual data visualization
✅ Four chart types: Line, Pie, Bar, and List
✅ Comprehensive date range filtering with groupBy support
✅ Two export mechanisms (analytics + program-specific)
✅ Proper state management with React hooks
✅ Error handling and loading states
✅ Empty state handling with meaningful messages
✅ Responsive grid layouts with Tailwind
✅ API client integration with typed responses
✅ Event tracking for analytics page views

**Minor Issues:**
⚠️ EmptyState component could be more visually engaging
⚠️ No loading skeleton during chart data fetch
⚠️ Chart colors hardcoded (not theme-aware)

**Code Quality:**
- Clean component structure
- Type-safe API calls using TypeScript
- Proper separation of concerns (download utility extracted)
- Accessible form labels

---

### Backend Implementation
**GRADE: A+ (98/100)**

**Analytics Data Lambda (`user-analytics.ts`):**
✅ 4 separate queries for different analytics aspects
✅ SQL injection protection via `validateGroupByPeriod` function
✅ Parameterized queries with proper value binding
✅ Date range filtering support
✅ Time series aggregation with DATE_TRUNC
✅ Proper NULL handling (NULLS LAST in ORDER BY)
✅ JSONB metrics extraction with type casting
✅ Authentication required

**Export Analytics Lambda (`export-analytics.ts`):**
✅ CSV generation with proper escaping
✅ Date filtering support
✅ Content-Disposition header for download
✅ NULL/empty field handling

**Program CSV Export Lambda (`csv-export.ts`):**
✅ Four different export formats based on AWS programs
✅ LATERAL JOIN for efficient URL retrieval
✅ Analytics event logging for audit trail
✅ IP anonymization for GDPR compliance
✅ CSV escaping function with quote handling

**Data Aggregation Quality:**
```sql
-- Example: Content by type
SELECT content_type, COUNT(*) as count
FROM content
WHERE user_id = $1 AND deleted_at IS NULL
GROUP BY content_type

-- Example: Top tags
SELECT UNNEST(tags) as tag, COUNT(*) as count
FROM content
WHERE user_id = $1 AND deleted_at IS NULL
GROUP BY tag
ORDER BY count DESC
LIMIT 10

-- Example: Time series
SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as views
FROM analytics_events
WHERE user_id = $1 AND event_type = 'content_view'
GROUP BY date
ORDER BY date
```

**Security:**
✅ SQL injection prevention (whitelist validation)
✅ Authentication checks
✅ User isolation (user_id filtering)

---

## Test Coverage Assessment
**GRADE: D (25/100)**

### ✅ Backend Tests: EXCELLENT
**Files Tested:**
1. `tests/backend/lambdas/analytics/user-analytics.test.ts` (305 lines, 12 tests)
2. `tests/backend/lambdas/analytics/export-analytics.test.ts` (216 lines, 7 tests)
3. `tests/backend/lambdas/export/csv-export.test.ts` (exists, program exports)

**Coverage:**
- ✅ Content distribution aggregation
- ✅ Top tags retrieval
- ✅ Top content ranking
- ✅ Time series data with day/week/month grouping
- ✅ Date range filtering
- ✅ Authentication requirements
- ✅ CSV generation and escaping
- ✅ SQL injection protection (invalid groupBy values)
- ✅ Case-insensitive parameter handling
- ✅ NULL metrics handling

**Test Quality Examples:**
```typescript
it('should prevent SQL injection via groupBy parameter', async () => {
  const event = createMockEvent('user-123', {
    groupBy: "day'; DROP TABLE users; --",
  });

  const response = await handler(event, {} as any);

  expect(response.statusCode).toBe(200);
  expect(body.data.groupBy).toBe('day'); // Sanitized to safe default
  expect(mockPool.query).not.toHaveBeenCalledWith(
    expect.stringContaining('DROP TABLE'),
    expect.any(Array)
  );
});
```

### ❌ Frontend Tests: MISSING
**CRITICAL ISSUE:**
- **NO tests exist** for `src/frontend/app/dashboard/analytics/page.tsx`
- Directory does not exist: `tests/frontend/app/dashboard/analytics/`
- 412 lines of frontend code with 0% test coverage

**Missing Test Scenarios:**
1. ❌ Chart rendering with mock data
2. ❌ Date range selector interactions
3. ❌ Group by selector changes
4. ❌ Export button clicks
5. ❌ Loading states
6. ❌ Error handling
7. ❌ Empty state rendering
8. ❌ API call mocking
9. ❌ Responsive behavior
10. ❌ User interactions (filter apply/clear)

**Expected Tests (should exist):**
```typescript
// tests/frontend/app/dashboard/analytics/page.test.tsx
describe('AnalyticsDashboardPage', () => {
  it('should render time series chart with data');
  it('should render pie chart for topic distribution');
  it('should render bar chart for channel performance');
  it('should render top performing content list');
  it('should update charts when date range changes');
  it('should export analytics CSV on button click');
  it('should export program CSV with correct format');
  it('should show loading state while fetching data');
  it('should show error message on API failure');
  it('should show empty state when no data available');
  it('should change groupBy and reload data');
  it('should clear filters and reset to defaults');
});
```

---

## Issues Found

### 🔴 Critical Issues

**Issue 1: No Frontend Tests**
- **Severity:** CRITICAL
- **File:** `tests/frontend/app/dashboard/analytics/` (does not exist)
- **Description:** 412 lines of frontend analytics dashboard code with 0% test coverage. This is a user-facing feature with complex state management, API calls, and chart rendering.
- **Impact:** High risk of regressions, no validation of user interactions, chart rendering, or error handling
- **Fix Required:**
  ```typescript
  // Create: tests/frontend/app/dashboard/analytics/page.test.tsx

  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import AnalyticsDashboardPage from '@/app/dashboard/analytics/page';
  import { apiClient } from '@/api';

  jest.mock('@/api');

  describe('AnalyticsDashboardPage', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        contentByType: { blog: 10, youtube: 5 },
        topTags: [{ tag: 'AWS', count: 15 }],
        topContent: [{ id: '1', title: 'Test', contentType: 'blog', views: 100 }],
        timeSeries: [{ date: '2024-01-01', views: 50 }],
        dateRange: null,
        groupBy: 'day',
      });
    });

    it('should render all chart sections', async () => {
      render(<AnalyticsDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Content Views Over Time')).toBeInTheDocument();
        expect(screen.getByText('Channel Performance')).toBeInTheDocument();
        expect(screen.getByText('Topic Distribution')).toBeInTheDocument();
        expect(screen.getByText('Top Performing Content')).toBeInTheDocument();
      });
    });

    it('should fetch analytics on mount', async () => {
      render(<AnalyticsDashboardPage />);

      await waitFor(() => {
        expect(apiClient.getUserAnalytics).toHaveBeenCalledWith({
          startDate: undefined,
          endDate: undefined,
          groupBy: 'day',
        });
      });
    });

    it('should update analytics when date range changes', async () => {
      const user = userEvent.setup();
      render(<AnalyticsDashboardPage />);

      const startDateInput = screen.getByLabelText('Start Date');
      const endDateInput = screen.getByLabelText('End Date');
      const applyButton = screen.getByText('Apply');

      await user.type(startDateInput, '2024-01-01');
      await user.type(endDateInput, '2024-12-31');
      await user.click(applyButton);

      await waitFor(() => {
        expect(apiClient.getUserAnalytics).toHaveBeenCalledWith({
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          groupBy: 'day',
        });
      });
    });

    it('should export analytics CSV', async () => {
      const user = userEvent.setup();
      const mockDownload = { blob: new Blob(), filename: 'analytics.csv' };
      (apiClient.exportAnalyticsCsv as jest.Mock).mockResolvedValue(mockDownload);

      render(<AnalyticsDashboardPage />);

      await waitFor(() => screen.getByText('Export Analytics CSV'));

      const exportButton = screen.getByText('Export Analytics CSV');
      await user.click(exportButton);

      await waitFor(() => {
        expect(apiClient.exportAnalyticsCsv).toHaveBeenCalled();
      });
    });

    it('should show empty state when no data', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        contentByType: {},
        topTags: [],
        topContent: [],
        timeSeries: [],
        dateRange: null,
        groupBy: 'day',
      });

      render(<AnalyticsDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('No analytics data for the selected range.')).toBeInTheDocument();
      });
    });

    it('should handle API errors', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockRejectedValue(
        new Error('Failed to load analytics')
      );

      render(<AnalyticsDashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load analytics data')).toBeInTheDocument();
      });
    });
  });
  ```

---

### 🟡 Minor Issues

**Issue 2: Chart Loading State**
- **Severity:** MINOR
- **File:** `src/frontend/app/dashboard/analytics/page.tsx`
- **Description:** Charts show "Loading analytics…" text but no skeleton placeholders
- **Impact:** Poor UX during data fetch
- **Suggestion:** Add skeleton placeholders for charts while loading

**Issue 3: Chart Color Theme**
- **Severity:** MINOR
- **File:** `src/frontend/app/dashboard/analytics/page.tsx` (line 34)
- **Description:** Chart colors hardcoded: `['#2563eb', '#16a34a', '#f97316', ...]`
- **Impact:** Not theme-aware, won't adapt to dark mode
- **Suggestion:** Use CSS variables or Tailwind theme colors

**Issue 4: No Chart Legends for Line/Bar Charts**
- **Severity:** MINOR
- **File:** `src/frontend/app/dashboard/analytics/page.tsx`
- **Description:** Only pie chart has `<Legend />` component
- **Impact:** Reduced clarity for multi-series charts (if added in future)
- **Suggestion:** Add legends consistently across all charts

---

## Data Quality Assessment

### Database Schema
**GRADE: A (95/100)**

**Analytics Events Table:**
```sql
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type event_type_enum NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}' NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

**Indexes:**
✅ `idx_analytics_events_type` - Event type filtering
✅ `idx_analytics_events_user_id` - User-specific queries
✅ `idx_analytics_events_content_id` - Content performance
✅ `idx_analytics_events_created_at` - Time-based sorting (DESC)
✅ `idx_analytics_events_session_id` - Session tracking
✅ `idx_analytics_events_metadata` - GIN index for JSONB queries

**Data Aggregation:**
- Time series uses indexed `created_at` column
- User filtering uses indexed `user_id` column
- Content metrics stored in JSONB with proper casting
- Tag unnesting for topic distribution

---

## Security Assessment
**GRADE: A+ (100/100)**

✅ **SQL Injection Prevention:**
```typescript
const VALID_GROUP_BY_PERIODS = ['day', 'week', 'month'] as const;

function validateGroupByPeriod(groupBy: string | undefined): GroupByPeriod {
  const normalized = (groupBy || 'day').toLowerCase();

  if (VALID_GROUP_BY_PERIODS.includes(normalized as GroupByPeriod)) {
    return normalized as GroupByPeriod;
  }

  return 'day'; // Safe default
}
```

✅ **Authentication:**
- All endpoints check `authorizer.userId`
- Return 401 for unauthenticated requests

✅ **User Isolation:**
- All queries filter by `user_id = $1`
- Users can only see their own analytics

✅ **GDPR Compliance:**
- IP anonymization in export tracking
- User consent checking for authenticated users
- Anonymous session tracking with session_id only

---

## Performance Assessment
**GRADE: A- (90/100)**

**Strengths:**
✅ Proper database indexing on all query columns
✅ LIMIT clauses on top tags (10) and top content (10)
✅ Efficient LATERAL JOIN for URL retrieval
✅ DATE_TRUNC for time series aggregation
✅ Frontend state management prevents unnecessary re-renders

**Potential Optimizations:**
⚠️ Could add pagination for large datasets
⚠️ Consider caching frequently accessed analytics
⚠️ Time series query could benefit from materialized view for large datasets

---

## Recommendations

### 🔴 MUST FIX (Before Task Completion)

1. **Create Frontend Tests**
   - Priority: CRITICAL
   - Estimated effort: 4-6 hours
   - Create `tests/frontend/app/dashboard/analytics/page.test.tsx`
   - Minimum 10 test cases covering:
     - Chart rendering
     - Date range filtering
     - Export functionality
     - Loading/error states
     - User interactions

### 🟡 SHOULD FIX (Next Sprint)

2. **Add Chart Loading Skeletons**
   - Improve UX during data fetch
   - Use shimmer effect for chart containers

3. **Theme-Aware Chart Colors**
   - Use Tailwind theme colors
   - Support dark mode

4. **Add Pagination for Top Content**
   - If more than 10 items, add "Load More" or pagination

### 🟢 COULD IMPROVE (Future)

5. **Add Chart Interactivity**
   - Click on chart elements to drill down
   - Hover tooltips with more details

6. **Add Date Range Presets**
   - "Last 7 Days", "Last 30 Days", "Last Quarter"
   - Quick selection buttons

7. **Add Export to PDF**
   - Generate PDF reports with charts
   - Include visualizations in export

---

## Conclusion

Task 7.4 delivers a **fully functional analytics dashboard** with real data visualization, comprehensive backend aggregation, and proper CSV export capabilities. The implementation meets all 7 acceptance criteria with high-quality code and robust backend testing.

However, the **complete absence of frontend tests is a critical gap** that prevents this task from achieving a full pass. The analytics dashboard is a complex user-facing feature with 412 lines of code, state management, API integrations, and chart rendering - all of which require test coverage to ensure reliability and prevent regressions.

**Final Assessment:**
- ✅ Requirements: 100% complete
- ✅ Backend: Excellent implementation and testing
- ✅ Frontend: Excellent implementation, ZERO testing
- ⚠️ Overall: Partial Pass (75%)

**Recommendation:** Add frontend tests before marking this task as complete. The backend work is excellent and production-ready. The frontend implementation is also high quality but lacks the safety net of automated tests.

---

## Test Coverage Gap Analysis

### Current Coverage
```
Backend:
├── user-analytics.ts ✅ 12 tests (305 lines)
├── export-analytics.ts ✅ 7 tests (216 lines)
├── csv-export.ts ✅ Tests exist
└── track-event.ts ✅ Tests exist

Frontend:
└── analytics/page.tsx ❌ 0 tests (412 lines) ⚠️ CRITICAL GAP
```

### Required Test Files
```
tests/frontend/app/dashboard/analytics/
├── page.test.tsx (MISSING - REQUIRED)
├── useAnalytics.test.ts (if hook extracted)
└── AnalyticsChart.test.tsx (if component extracted)
```

---

## Verification Checklist

- [x] Time series charts implemented
- [x] Topic distribution pie chart implemented
- [x] Channel performance bar chart implemented
- [x] Top performing content list implemented
- [x] Date range selector implemented
- [x] Export to CSV implemented (2 types)
- [x] Responsive charts implemented
- [x] Backend aggregation tested
- [x] SQL injection protection tested
- [x] CSV generation tested
- [x] Authentication tested
- [ ] **Frontend component tested** ❌ MISSING
- [ ] **User interactions tested** ❌ MISSING
- [ ] **Chart rendering tested** ❌ MISSING

---

**Report Generated:** 2025-10-18
**Verification Method:** Code review, test analysis, implementation inspection
**Reviewer:** Senior Code Review Agent
**Next Action:** Create frontend tests to achieve 100% completion
