import type { Metadata } from 'next';
import '../src/styles/globals.css';
import dynamic from 'next/dynamic';
import { isBetaModeActive } from '@/lib/featureFlags';
import { getClientEnvironment } from '@/config/environment';
import Link from 'next/link';

const CookieConsentBoundary = dynamic(() => import('./CookieConsentBoundary'), {
  loading: () => null,
});

const { NEXT_PUBLIC_SITE_URL: siteUrl } = getClientEnvironment();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'AWS Community Content Hub',
  description: 'Discover and track AWS community content from contributors worldwide',
  keywords: 'AWS, community, content, developers, cloud computing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const betaActive = isBetaModeActive();

  return (
    <html lang="en">
      <body>
        <nav className="bg-aws-blue text-white shadow-lg">
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="text-2xl font-bold flex items-center gap-2">
              <span>AWS Community Hub</span>
              {betaActive && (
                <span className="rounded-full bg-aws-orange px-2 py-1 text-xs font-semibold text-gray-900">
                  Beta
                </span>
              )}
            </Link>
            <div className="space-x-4">
              <Link href="/search" className="hover:text-aws-orange transition-colors">Search</Link>
              {betaActive && (
                <Link
                  href="/feedback"
                  className="hover:text-aws-orange transition-colors"
                >
                  Feedback
                </Link>
              )}
              <Link href="/auth/login" className="hover:text-aws-orange transition-colors">Login</Link>
              <Link href="/auth/register" className="btn-primary">Register</Link>
            </div>
          </div>
        </nav>
        <main className="min-h-screen">{children}</main>
        <footer className="bg-gray-800 text-white py-8 mt-16">
          <div className="container mx-auto px-4 text-center">
            <p>AWS Community Content Hub - Open Source Project</p>
            <p className="text-sm text-gray-400 mt-2">Built with Next.js, AWS Lambda, and PostgreSQL</p>
            <div className="mt-4 flex justify-center gap-4 text-sm text-gray-300">
              <Link href="/privacy" className="hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white">
                Terms of Service
              </Link>
              {betaActive && (
                <Link href="/feedback" className="hover:text-white">
                  Share Feedback
                </Link>
              )}
            </div>
          </div>
        </footer>
        <CookieConsentBoundary />
      </body>
    </html>
  );
}
