'use client';

import dynamic from 'next/dynamic';
import type { Visibility } from '@shared/types';
import type { VisibilityChartSlice } from './VisibilityChart';

const VisibilityChart = dynamic(() => import('./VisibilityChart'), {
  ssr: false,
  loading: () => (
    <div className="h-48 rounded border border-gray-200 bg-gray-50 text-sm text-gray-500 flex items-center justify-center">
      Loading visibility data…
    </div>
  ),
});

interface VisibilityPanelProps {
  hasContent: boolean;
  data: VisibilityChartSlice[];
}

export default function VisibilityPanel({ hasContent, data }: VisibilityPanelProps): JSX.Element {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Visibility Distribution</h2>
      {hasContent ? <VisibilityChart data={data} /> : <p className="text-gray-500 text-sm">No data to display</p>}
    </div>
  );
}

export type { VisibilityChartSlice } from './VisibilityChart';

