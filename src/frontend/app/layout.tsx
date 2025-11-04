import type { Metadata } from 'next';
import '../src/styles/globals.css';
import dynamic from 'next/dynamic';
import { isBetaModeActive } from '@/lib/featureFlags';

const CookieConsentBoundary = dynamic(() => import('./CookieConsentBoundary'), {
  loading: () => null,
});

const appOrigin =
  process.env.NEXT_PUBLIC_DOMAIN && process.env.NEXT_PUBLIC_DOMAIN.trim().length > 0
    ? `https://${process.env.NEXT_PUBLIC_DOMAIN}`
    : 'https://awscommunityhub.org';

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin),
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
            <a href="/" className="text-2xl font-bold flex items-center gap-2">
              <span>AWS Community Hub</span>
              {betaActive && (
                <span className="rounded-full bg-aws-orange px-2 py-1 text-xs font-semibold text-gray-900">
                  Beta
                </span>
              )}
            </a>
            <div className="space-x-4">
              <a href="/search" className="hover:text-aws-orange transition-colors">Search</a>
              {betaActive && (
                <a
                  href="/feedback"
                  className="hover:text-aws-orange transition-colors"
                >
                  Feedback
                </a>
              )}
              <a href="/auth/login" className="hover:text-aws-orange transition-colors">Login</a>
              <a href="/auth/register" className="btn-primary">Register</a>
            </div>
          </div>
        </nav>
        <main className="min-h-screen">{children}</main>
        <footer className="bg-gray-800 text-white py-8 mt-16">
          <div className="container mx-auto px-4 text-center">
            <p>AWS Community Content Hub - Open Source Project</p>
            <p className="text-sm text-gray-400 mt-2">Built with Next.js, AWS Lambda, and PostgreSQL</p>
            <div className="mt-4 flex justify-center gap-4 text-sm text-gray-300">
              <a href="/privacy" className="hover:text-white">
                Privacy Policy
              </a>
              <a href="/terms" className="hover:text-white">
                Terms of Service
              </a>
              {betaActive && (
                <a href="/feedback" className="hover:text-white">
                  Share Feedback
                </a>
              )}
            </div>
          </div>
        </footer>
        <CookieConsentBoundary />
      </body>
    </html>
  );
}
