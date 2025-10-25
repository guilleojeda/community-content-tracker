'use client';

import React from 'react';
import { Visibility } from '@shared/types';
import { VISIBILITY_COLORS } from '@/lib/constants/ui';

export interface VisibilityChartSlice {
  name: Visibility | string;
  value: number;
}

interface Props {
  data: VisibilityChartSlice[];
}

export function VisibilityChart({ data }: Props): JSX.Element {
  if (!data.length) {
    return <p className="text-sm text-gray-500">No data to display</p>;
  }

  const total = data.reduce((sum, entry) => sum + entry.value, 0) || 1;

  return (
    <div data-testid="visibility-chart" className="space-y-3">
      {data.map(entry => {
        const percent = Math.round((entry.value / total) * 100);
        const color = VISIBILITY_COLORS[entry.name as Visibility] ?? '#2563eb';
        return (
          <div key={entry.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize text-gray-700">{entry.name.replace(/_/g, ' ')}</span>
              <span className="text-gray-600">{entry.value} · {percent}%</span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default VisibilityChart;
