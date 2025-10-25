import dynamic from 'next/dynamic';

const DashboardHomeView = dynamic(() => import('./DashboardHomeView'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6 animate-pulse">
        <div className="h-6 w-1/3 bg-gray-200 rounded" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  ),
});

export default function DashboardPage(): JSX.Element {
  return <DashboardHomeView />;
}
