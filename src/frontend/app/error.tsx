'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          <div className="text-6xl mb-4">WARN</div>
          <h2 className="text-3xl font-bold text-aws-blue mb-4">
            Something went wrong!
          </h2>
          <p className="text-gray-600 mb-6">
            We apologize for the inconvenience. An error occurred while processing your request.
          </p>
          {error.digest && (
            <p className="text-sm text-gray-500 mb-6">
              Error ID: {error.digest}
            </p>
          )}
          <div className="space-y-3">
            <button
              onClick={() => reset()}
              className="btn-primary w-full sm:w-auto"
            >
              Try again
            </button>
            <br />
            <Link
              href="/"
              className="btn-secondary w-full sm:w-auto inline-block"
            >
              Return to homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
