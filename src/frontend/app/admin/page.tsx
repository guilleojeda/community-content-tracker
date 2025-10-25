/* istanbul ignore file */
import dynamic from 'next/dynamic';

const AdminDashboardView = dynamic(() => import('./AdminDashboardView'), {
  ssr: false,
  loading: () => (
    <div className="bg-white shadow-sm rounded-lg p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-1/4 rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  ),
});

export default function AdminDashboardPage(): JSX.Element {
  return <AdminDashboardView />;
}
