'use client';

import { useEffect, useState } from 'react';
import { loadAuthenticatedApiClient } from '@/lib/api/lazyClient';

const STORAGE_KEY = 'cookie-consent';

function shouldShowBanner(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored !== 'accepted' && stored !== 'declined';
}

export default function CookieConsentBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setVisible(shouldShowBanner());
    setHydrated(true);
  }, []);

  const persistPreference = (value: 'accepted' | 'declined') => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore storage access issues
    }
  };

  const handleAccept = async () => {
    persistPreference('accepted');

    try {
      const token = window.localStorage.getItem('accessToken');
      if (token) {
        const client = await loadAuthenticatedApiClient();
        await client.manageConsent({ consentType: 'analytics', granted: true });
      }
    } catch (error) {
      console.warn('Failed to record analytics consent preference', error);
    } finally {
      setVisible(false);
    }
  };

  const handleDecline = () => {
    persistPreference('declined');
    setVisible(false);
  };

  if (!hydrated) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-50 bg-gray-900 text-white shadow-lg translate-y-full opacity-0 pointer-events-none" aria-hidden="true">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">We use cookies</h2>
            <p className="text-sm text-gray-300 mt-1">
              We use necessary cookies to run the site and analytics cookies to understand engagement. You can change your
              preferences at any time from your privacy settings.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md border border-gray-500 px-4 py-2 text-sm font-medium">
              Decline
            </button>
            <button type="button" className="rounded-md bg-aws-orange px-4 py-2 text-sm font-semibold text-gray-900">
              Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-gray-900 text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">We use cookies</h2>
          <p className="text-sm text-gray-300 mt-1">
            We use necessary cookies to run the site and analytics cookies to understand engagement. You can change your
            preferences at any time from your privacy settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-gray-500 px-4 py-2 text-sm font-medium hover:bg-gray-800"
            onClick={handleDecline}
          >
            Decline
          </button>
          <button
            type="button"
            className="rounded-md bg-aws-orange px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-orange-500"
            onClick={handleAccept}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
