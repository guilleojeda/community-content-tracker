export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-aws-orange border-r-transparent mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
}
