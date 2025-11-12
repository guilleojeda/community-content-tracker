import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AnalyticsDashboardPage from '../../../../../src/frontend/app/dashboard/analytics/page';
import { apiClient } from '../../../../../src/frontend/src/api';

// Mock API client
jest.mock('../../../../../src/frontend/src/api', () => ({
  apiClient: {
    getUserAnalytics: jest.fn(),
    exportAnalyticsCsv: jest.fn(),
    exportProgramCsv: jest.fn(),
    trackAnalyticsEvents: jest.fn(),
    getExportHistory: jest.fn(),
  },
}));

// Mock download utility
jest.mock('../../../../../src/frontend/src/utils/download', () => ({
  downloadBlob: jest.fn(),
}));

const mockedDownload = jest.requireMock('../../../../../src/frontend/src/utils/download')
  .downloadBlob as jest.MockedFunction<typeof import('../../../../../src/frontend/src/utils/download').downloadBlob>;

describe('AnalyticsDashboardPage', () => {
  const mockAnalyticsData = {
    timeSeries: [
      { date: '2024-01-01', views: 100 },
      { date: '2024-01-02', views: 150 },
      { date: '2024-01-03', views: 200 },
    ],
    contentByType: {
      blog: 25,
      youtube: 15,
      github: 10,
    },
    topTags: [
      { tag: 'aws', count: 50 },
      { tag: 'lambda', count: 30 },
      { tag: 'serverless', count: 20 },
    ],
    topContent: [
      { id: '1', title: 'Top Post 1', contentType: 'blog', views: 500 },
      { id: '2', title: 'Top Video 1', contentType: 'youtube', views: 450 },
      { id: '3', title: 'Top Repo 1', contentType: 'github', views: 400 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue(mockAnalyticsData);
    (apiClient.trackAnalyticsEvents as jest.Mock).mockResolvedValue({});
    (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
      history: [],
      total: 0,
      limit: 10,
      offset: 0,
    });
    mockedDownload.mockReset();
    delete (window as any).matchMedia;
  });

  async function renderDashboard() {
    const utils = render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(apiClient.getUserAnalytics).toHaveBeenCalled());
    await waitFor(() => expect(apiClient.getExportHistory).toHaveBeenCalled());
    return utils;
  }

  describe('Initial Rendering', () => {
    it('should render the analytics dashboard page', async () => {
      await renderDashboard();
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
    });

    it('should show loading state initially', () => {
      (apiClient.getUserAnalytics as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AnalyticsDashboardPage />);

      expect(screen.getByText('Loading analytics…')).toBeInTheDocument();
    });

    it('should load analytics data on mount', async () => {
      await renderDashboard();

      expect(apiClient.getUserAnalytics).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        groupBy: 'day',
      });
      expect(apiClient.getExportHistory).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });
  });

  describe('Chart Rendering', () => {
    it('should render time series line chart with data', async () => {
      await renderDashboard();
      expect(screen.getByText('Content Views Over Time')).toBeInTheDocument();
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('should render channel performance bar chart with data', async () => {
      await renderDashboard();
      expect(screen.getByText('Channel Performance')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('should render topic distribution pie chart with data', async () => {
      await renderDashboard();
      expect(screen.getByText('Topic Distribution')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should render top performing content list', async () => {
      await renderDashboard();
      expect(screen.getByText('Top Post 1')).toBeInTheDocument();
      expect(screen.getByText('Top Video 1')).toBeInTheDocument();
      expect(screen.getByText('Top Repo 1')).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no time series data', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        ...mockAnalyticsData,
        timeSeries: [],
      });

      await renderDashboard();
      expect(screen.getByText('No analytics data for the selected range.')).toBeInTheDocument();
    });

    it('should show empty state when no content distribution data', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        ...mockAnalyticsData,
        contentByType: {},
      });

      await renderDashboard();
      expect(screen.getByText('Add content to view channel performance.')).toBeInTheDocument();
    });

    it('should show empty state when no tags data', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        ...mockAnalyticsData,
        topTags: [],
      });

      await renderDashboard();
      expect(screen.getByText('No tag analytics available yet.')).toBeInTheDocument();
    });

    it('should show empty state when no top content data', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockResolvedValue({
        ...mockAnalyticsData,
        topContent: [],
      });

      await renderDashboard();
      expect(screen.getByText('Performance metrics unavailable for the selected range.')).toBeInTheDocument();
    });
  });

  describe('Date Filter Interactions', () => {
    it('should update start date filter', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByLabelText('Start Date')).toBeInTheDocument();
      });

      const startDateInput = screen.getByLabelText('Start Date') as HTMLInputElement;
      fireEvent.change(startDateInput, { target: { value: '2024-01-01' } });

      expect(startDateInput.value).toBe('2024-01-01');
    });

    it('should update end date filter', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByLabelText('End Date')).toBeInTheDocument();
      });

      const endDateInput = screen.getByLabelText('End Date') as HTMLInputElement;
      fireEvent.change(endDateInput, { target: { value: '2024-12-31' } });

      expect(endDateInput.value).toBe('2024-12-31');
    });

    it('should update group by filter', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByLabelText('Group By')).toBeInTheDocument();
      });

      const groupBySelect = screen.getByLabelText('Group By') as HTMLSelectElement;
      fireEvent.change(groupBySelect, { target: { value: 'month' } });

      expect(groupBySelect.value).toBe('month');
    });

    it('should apply filters and reload analytics', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Apply')).toBeInTheDocument();
      });

      // Set filters
      const startDateInput = screen.getByLabelText('Start Date') as HTMLInputElement;
      const endDateInput = screen.getByLabelText('End Date') as HTMLInputElement;
      const groupBySelect = screen.getByLabelText('Group By') as HTMLSelectElement;

      fireEvent.change(startDateInput, { target: { value: '2024-01-01' } });
      fireEvent.change(endDateInput, { target: { value: '2024-12-31' } });
      fireEvent.change(groupBySelect, { target: { value: 'week' } });

      // Click apply
      const applyButton = screen.getByText('Apply');
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(apiClient.getUserAnalytics).toHaveBeenCalledWith({
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          groupBy: 'week',
        });
      });
    });

    it('should clear filters and reload with defaults', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Clear')).toBeInTheDocument();
      });

      // Set some filters first
      const startDateInput = screen.getByLabelText('Start Date') as HTMLInputElement;
      fireEvent.change(startDateInput, { target: { value: '2024-01-01' } });

      // Click clear
      const clearButton = screen.getByText('Clear');
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(apiClient.getUserAnalytics).toHaveBeenCalledWith({
          startDate: undefined,
          endDate: undefined,
          groupBy: 'day',
        });
      });

      expect(startDateInput.value).toBe('');
    });
  });

  describe('CSV Export Functionality', () => {
    it('should export analytics CSV', async () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      const mockDownload = {
        blob: mockBlob,
        filename: 'analytics-export.csv',
      };

      (apiClient.exportAnalyticsCsv as jest.Mock).mockResolvedValue(mockDownload);

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Analytics CSV');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(apiClient.exportAnalyticsCsv).toHaveBeenCalledTimes(1);
      });

      expect(apiClient.exportAnalyticsCsv).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        groupBy: 'day',
      });
    });

    it('should export program-specific CSV', async () => {
      const mockBlob = new Blob(['program csv data'], { type: 'text/csv' });
      const mockDownload = {
        blob: mockBlob,
        filename: 'community_builder-export.csv',
      };

      (apiClient.exportProgramCsv as jest.Mock).mockResolvedValue(mockDownload);

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Program CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Program CSV');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(apiClient.exportProgramCsv).toHaveBeenCalledTimes(1);
      });

      expect(apiClient.exportProgramCsv).toHaveBeenCalledWith({
        programType: 'community_builder',
        startDate: undefined,
        endDate: undefined,
      });
    });

    it('should change program type for export', async () => {
      await renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Program Export')).toBeInTheDocument();
      });

      // Find the program select dropdown (within the Program Export section)
      const programSelects = screen.getAllByRole('combobox');
      const programSelect = programSelects.find(select =>
        (select as HTMLSelectElement).value === 'community_builder'
      ) as HTMLSelectElement;

      expect(programSelect).toBeDefined();
      fireEvent.change(programSelect!, { target: { value: 'hero' } });

      expect(programSelect!.value).toBe('hero');
    });

    it('should disable export buttons while exporting', async () => {
      (apiClient.exportAnalyticsCsv as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Analytics CSV') as HTMLButtonElement;
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(exportButton.disabled).toBe(true);
      });
    });

    it('should show success message after export', async () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      (apiClient.exportAnalyticsCsv as jest.Mock).mockResolvedValue({
        blob: mockBlob,
        filename: 'analytics-export.csv',
      });

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Analytics CSV');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(screen.getByText('Analytics CSV exported successfully.')).toBeInTheDocument();
      });
    });

    it('uses fallback filename when analytics export response omits filename', async () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      (apiClient.exportAnalyticsCsv as jest.Mock).mockResolvedValue({
        blob: mockBlob,
        filename: undefined,
      });

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Export Analytics CSV'));

      await waitFor(() => {
        expect(mockedDownload).toHaveBeenCalledWith(mockBlob, 'analytics-export.csv');
      });
    });
  });

  describe('Export History', () => {
    it('should render export history entries when available', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'evt-1',
            exportType: 'program',
            exportFormat: 'community_builder',
            rowCount: 5,
            createdAt: new Date('2024-02-01T10:00:00Z').toISOString(),
            parameters: {
              programType: 'community_builder',
              startDate: '2024-01-01',
              endDate: '2024-01-31',
              groupBy: null,
            },
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export History')).toBeInTheDocument());

      expect(screen.getByText(/Program: community_builder/i)).toBeInTheDocument();
      expect(screen.getByText(/rows/i)).toBeInTheDocument();
    });

    it('should show empty state when no export history exists', async () => {
      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export History')).toBeInTheDocument());

      expect(screen.getByText('No export history yet.')).toBeInTheDocument();
    });

    it('supports paginating through export history results', async () => {
      (apiClient.getExportHistory as jest.Mock)
        .mockResolvedValueOnce({
          history: Array.from({ length: 5 }).map((_, index) => ({
            id: `entry-${index}`,
            exportType: 'analytics',
            exportFormat: null,
            rowCount: 100,
            createdAt: new Date().toISOString(),
            parameters: { groupBy: 'day', startDate: null, endDate: null },
          })),
          total: 12,
          limit: 5,
          offset: 0,
        })
        .mockResolvedValueOnce({
          history: Array.from({ length: 5 }).map((_, index) => ({
            id: `entry-next-${index}`,
            exportType: 'analytics',
            exportFormat: null,
            rowCount: 50,
            createdAt: new Date().toISOString(),
            parameters: { groupBy: 'week', startDate: null, endDate: null },
          })),
          total: 12,
          limit: 5,
          offset: 5,
        });

      await renderDashboard();

      await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).toBeEnabled());
      const nextButton = screen.getByRole('button', { name: /Next/i });
      await userEvent.click(nextButton);

      await waitFor(() => {
        const lastCall = (apiClient.getExportHistory as jest.Mock).mock.calls.at(-1)?.[0];
        expect(lastCall).toEqual({ limit: 5, offset: 5 });
      });
    });

    it('surfaces history-specific errors gracefully', async () => {
      (apiClient.getExportHistory as jest.Mock).mockRejectedValueOnce(new Error('History unavailable'));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('History unavailable')).toBeInTheDocument());
    });

    it('falls back to default history error for non-error rejection', async () => {
      (apiClient.getExportHistory as jest.Mock).mockRejectedValueOnce('offline');

      await renderDashboard();
      await waitFor(() => expect(screen.getByText(/Failed to load export history/i)).toBeInTheDocument());
    });

    it('describes analytics exports with groupBy and range metadata', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'export-analytics',
            exportType: 'analytics',
            exportFormat: null,
            rowCount: 250,
            createdAt: new Date('2024-03-01T15:00:00Z').toISOString(),
            parameters: {
              groupBy: 'month',
              startDate: '2024-01-01',
              endDate: '2024-02-29',
            },
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      await waitFor(() =>
        expect(screen.getByText(/Analytics CSV export • Group By: month • Range: 2024-01-01 → 2024-02-29/)).toBeInTheDocument()
      );
    });

    it('describes program exports with program name and range metadata', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'program-export',
            exportType: 'program',
            exportFormat: null,
            rowCount: 42,
            createdAt: new Date().toISOString(),
            parameters: {
              programType: 'hero',
              startDate: '2024-05-01',
              endDate: '2024-05-31',
            },
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      expect(await screen.findByText(/Program: hero • Range: 2024-05-01 → 2024-05-31/i)).toBeInTheDocument();
    });

    it('falls back to export format when history entry type is unknown', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'custom-export',
            exportType: 'custom_type',
            exportFormat: 'custom.csv',
            rowCount: null,
            createdAt: new Date().toISOString(),
            parameters: {},
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      expect(await screen.findByText(/custom.csv/i)).toBeInTheDocument();
    });

    it('falls back to export format when program history lacks explicit program type', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'program-format-fallback',
            exportType: 'program',
            exportFormat: 'legacy.csv',
            rowCount: 12,
            createdAt: new Date().toISOString(),
            parameters: {},
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      expect(await screen.findByText(/Program: legacy\.csv/i)).toBeInTheDocument();
    });

    it('uses default program label when program type and export format are missing', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'program-default-label',
            exportType: 'program',
            exportFormat: undefined,
            rowCount: 8,
            createdAt: new Date().toISOString(),
            parameters: {},
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      expect(await screen.findByText(/Program: Program export/i)).toBeInTheDocument();
    });

    it('uses placeholder when export details resolve to an empty string', async () => {
      (apiClient.getExportHistory as jest.Mock).mockResolvedValue({
        history: [
          {
            id: 'custom-empty-details',
            exportType: 'custom_type',
            exportFormat: '',
            rowCount: null,
            createdAt: new Date().toISOString(),
            parameters: {},
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

      await renderDashboard();
      const typeCell = await screen.findByText(/custom type/i);
      const row = typeCell.closest('tr');
      expect(row).not.toBeNull();
      const cells = within(row!).getAllByRole('cell');
      expect(cells[2]).toHaveTextContent('—');
    });
  });

  describe('Error Handling', () => {
    it('should display error message when analytics loading fails', async () => {
      const errorMessage = 'Failed to load analytics';
      (apiClient.getUserAnalytics as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText(errorMessage)).toBeInTheDocument());
    });

    it('shows default analytics error when rejection is not an Error', async () => {
      (apiClient.getUserAnalytics as jest.Mock).mockRejectedValue('boom');

      await renderDashboard();
      await waitFor(() => expect(screen.getByText(/Failed to load analytics data/i)).toBeInTheDocument());
    });

    it('should display error message when CSV export fails', async () => {
      const errorMessage = 'Failed to export CSV';
      (apiClient.exportAnalyticsCsv as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Analytics CSV');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('shows default analytics export error when rejection is not an Error', async () => {
      (apiClient.exportAnalyticsCsv as jest.Mock).mockRejectedValue('nope');

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Analytics CSV')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Export Analytics CSV'));

      await waitFor(() => expect(screen.getByText(/Failed to export analytics CSV/i)).toBeInTheDocument());
    });

    it('should handle program export errors gracefully', async () => {
      const errorMessage = 'Failed to export program CSV';
      (apiClient.exportProgramCsv as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Program CSV')).toBeInTheDocument());

      const exportButton = screen.getByText('Export Program CSV');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('shows default program export error for non-error rejection', async () => {
      (apiClient.exportProgramCsv as jest.Mock).mockRejectedValue('fail');

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Export Program CSV')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Export Program CSV'));

      await waitFor(() => expect(screen.getByText(/Failed to export program CSV/i)).toBeInTheDocument());
    });
  });

  describe('Analytics Tracking', () => {
    it('should track page view event on successful load', async () => {
      await renderDashboard();
      await waitFor(() => expect(apiClient.trackAnalyticsEvents).toHaveBeenCalled());

      expect(apiClient.trackAnalyticsEvents).toHaveBeenCalledWith({
        eventType: 'page_view',
        metadata: {
          page: '/dashboard/analytics',
          groupBy: 'day',
          hasDateRange: false,
        },
      });
    });

    it('should not fail if analytics tracking fails', async () => {
      (apiClient.trackAnalyticsEvents as jest.Mock).mockRejectedValue(new Error('Tracking failed'));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument());

      // Page should still render successfully
      expect(screen.getByText('Content Views Over Time')).toBeInTheDocument();
    });
  });

  describe('Responsive Layout', () => {
    const mockMatchMedia = (matches: boolean) => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(() => ({
          matches,
          media: '(min-width: 1024px)',
          onchange: null,
          addListener: jest.fn(),
          removeListener: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        })),
      });
    };

    it('renders single-column layout on mobile viewports', async () => {
      mockMatchMedia(false);
      await renderDashboard();

      const overviewGrid = await screen.findByTestId('analytics-overview-grid');
      expect(overviewGrid).toHaveAttribute('data-layout', 'mobile');
      expect(overviewGrid.className).toContain('grid-cols-1');
    });

    it('renders two-column layout on desktop viewports', async () => {
      mockMatchMedia(true);
      await renderDashboard();

      const overviewGrid = await screen.findByTestId('analytics-overview-grid');
      const breakdownGrid = await screen.findByTestId('analytics-breakdown-grid');

      expect(overviewGrid).toHaveAttribute('data-layout', 'desktop');
      expect(overviewGrid.className).toContain('grid-cols-2');
      expect(breakdownGrid).toHaveAttribute('data-layout', 'desktop');
      expect(breakdownGrid.className).toContain('grid-cols-2');
    });
  });
});
