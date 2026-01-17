import { Metadata } from 'next';
import HomePageContent from './HomePageContent';
import { getClientEnvironment } from '@/config/environment';

const {
  NEXT_PUBLIC_SITE_URL: siteUrl,
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: googleVerification,
  NEXT_PUBLIC_YANDEX_SITE_VERIFICATION: yandexVerification,
} = getClientEnvironment();

const verification = {
  ...(googleVerification ? { google: googleVerification } : {}),
  ...(yandexVerification ? { yandex: yandexVerification } : {}),
};

export const metadata: Metadata = {
  title: 'AWS Community Content Hub - Discover AWS Community Contributors',
  description: 'Search and track community-generated content from AWS Heroes, Community Builders, and Ambassadors. Find blogs, videos, GitHub projects, and conference talks from AWS contributors worldwide.',
  keywords: [
    'AWS',
    'AWS Community',
    'AWS Heroes',
    'AWS Community Builders',
    'AWS Ambassadors',
    'AWS content',
    'cloud computing',
    'AWS blogs',
    'AWS tutorials',
    'AWS videos',
    'serverless',
    'cloud architecture'
  ],
  authors: [{ name: 'AWS Community Content Hub' }],
  creator: 'AWS Community Content Hub',
  publisher: 'AWS Community Content Hub',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'AWS Community Content Hub',
    description: 'Discover and track community-generated content from AWS Heroes, Community Builders, and Ambassadors worldwide.',
    url: siteUrl,
    siteName: 'AWS Community Content Hub',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.svg',
        width: 1200,
        height: 630,
        alt: 'AWS Community Content Hub - Discover AWS Community Content',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AWS Community Content Hub',
    description: 'Search and track community-generated content from AWS contributors worldwide.',
    images: ['/twitter-image.svg'],
    creator: '@AWSCommunity',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: Object.keys(verification).length > 0 ? verification : undefined,
  alternates: {
    canonical: siteUrl,
  },
  category: 'technology',
};

export default function HomePage() {
  return <HomePageContent />;
}
