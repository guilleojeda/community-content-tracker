import dynamic from 'next/dynamic';

const AdminAuditLogView = dynamic(() => import('./AdminAuditLogView'), {
  ssr: false,
  loading: () => (
    <div className="bg-white shadow-sm rounded-lg p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-1/4 rounded bg-gray-200" />
        <div className="h-32 rounded-lg bg-gray-100" />
      </div>
    </div>
  ),
});

export default function AdminAuditLogPage(): JSX.Element {
  return <AdminAuditLogView />;
}
