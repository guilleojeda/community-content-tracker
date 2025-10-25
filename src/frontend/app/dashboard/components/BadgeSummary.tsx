'use client';

import type { Badge, User } from '@shared/types';
import { getBadgeLabel } from '@/lib/constants/ui';

interface BadgeSummaryProps {
  user: User | null;
  badges: Badge[];
}

export default function BadgeSummary({ user, badges }: BadgeSummaryProps): JSX.Element {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">AWS Badges</h2>
      {user?.isAwsEmployee && (
        <div className="mb-3">
          <span className="inline-block bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">
            AWS Employee
          </span>
        </div>
      )}
      {badges.length > 0 ? (
        <div className="space-y-2">
          {badges.map(badge => (
            <div key={badge.id} className="inline-block mr-2 mb-2">
              <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium">
                {getBadgeLabel(badge.badgeType)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        !user?.isAwsEmployee && <p className="text-gray-500 text-sm">No badges yet</p>
      )}
    </div>
  );
}
