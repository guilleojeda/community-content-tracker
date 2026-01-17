import dynamic from 'next/dynamic';
import type { Badge, Content, User } from '@shared/types';
import { getBadgeLabel, getBadgeColor } from '@/lib/constants/ui';

interface ProfileClientProps {
  user: User;
  badges: Badge[];
  content: Content[];
}

const ProfileContentSection = dynamic(() => import('./ProfileContentSection'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-lg shadow-md p-8 mt-8">
      <p className="text-gray-600">Loading public content...</p>
    </div>
  ),
});

export default function ProfileClient({ user, badges, content }: ProfileClientProps) {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-aws-blue mb-2">{user.username}</h1>
            {user.email && <p className="text-gray-600">{user.email}</p>}
            {user.bio && <p className="text-gray-600 mt-2">{user.bio}</p>}
          </div>
        </div>

        {user.isAwsEmployee && (
          <div className="mt-4">
            <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-aws-orange text-white">
              AWS Employee
            </span>
          </div>
        )}

        {badges.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-3">AWS Program Badges</h2>
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span
                  key={badge.id}
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold text-white ${getBadgeColor(
                    badge.badgeType
                  )}`}
                >
                  {getBadgeLabel(badge.badgeType)}
                </span>
              ))}
            </div>
          </div>
        )}

        {user.socialLinks && Object.keys(user.socialLinks).length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Social Links</h3>
            <div className="flex gap-3">
              {user.socialLinks.twitter && (
                <a
                  href={user.socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 transition-colors text-sm font-semibold"
                  aria-label="Twitter"
                >
                  Twitter
                </a>
              )}
              {user.socialLinks.linkedin && (
                <a
                  href={user.socialLinks.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:text-blue-900 transition-colors text-sm font-semibold"
                  aria-label="LinkedIn"
                >
                  LinkedIn
                </a>
              )}
              {user.socialLinks.github && (
                <a
                  href={user.socialLinks.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-800 hover:text-gray-600 transition-colors text-sm font-semibold"
                  aria-label="GitHub"
                >
                  GitHub
                </a>
              )}
              {user.socialLinks.website && (
                <a
                  href={user.socialLinks.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-aws-orange hover:text-orange-700 transition-colors text-sm font-semibold"
                  aria-label="Website"
                >
                  Website
                </a>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 text-sm text-gray-500">
          Member since {new Date(user.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
          })}
        </div>

        {user.email && (
          <div className="mt-6">
            <a
              href={`mailto:${user.email}?subject=AWS Community - Contact from ${user.username}'s profile`}
              className="inline-flex items-center px-4 py-2 bg-aws-blue text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              Contact {user.username}
            </a>
          </div>
        )}
      </div>

      <ProfileContentSection content={content} username={user.username} />

      <div className="mt-8 text-center">
        <a href="/dashboard/search" className="text-aws-blue hover:text-aws-orange transition-colors font-medium">
          Back to Search
        </a>
      </div>
    </div>
  );
}
