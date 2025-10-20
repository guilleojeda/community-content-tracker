import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// Mock Recharts to avoid canvas rendering issues in tests
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div data-testid="pie" />,
  Cell: () => <div data-testid="cell" />,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  Legend: () => <div data-testid="legend" />,
}));

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
  });

  describe('Error Handling', () => {
    it('should display error message when analytics loading fails', async () => {
      const errorMessage = 'Failed to load analytics';
      (apiClient.getUserAnalytics as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await renderDashboard();
      await waitFor(() => expect(screen.getByText(errorMessage)).toBeInTheDocument());
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
});
