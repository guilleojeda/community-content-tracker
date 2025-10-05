import type { Metadata } from 'next';
import '../src/styles/globals.css';

export const metadata: Metadata = {
  title: 'AWS Community Content Hub',
  description: 'Discover and track AWS community content from contributors worldwide',
  keywords: 'AWS, community, content, developers, cloud computing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-aws-blue text-white shadow-lg">
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <a href="/" className="text-2xl font-bold">
              AWS Community Hub
            </a>
            <div className="space-x-4">
              <a href="/search" className="hover:text-aws-orange transition-colors">Search</a>
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
          </div>
        </footer>
      </body>
    </html>
  );
}
