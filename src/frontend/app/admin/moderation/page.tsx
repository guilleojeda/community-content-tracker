/* istanbul ignore file */
import dynamic from 'next/dynamic';

const AdminModerationView = dynamic(() => import('./AdminModerationView'), {
  ssr: false,
  loading: () => (
    <div className="bg-white shadow-sm rounded-lg p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-1/4 rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-20 rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  ),
});

export default function AdminModerationPage(): JSX.Element {
  return <AdminModerationView />;
}
