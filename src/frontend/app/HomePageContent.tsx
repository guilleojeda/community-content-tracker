'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { loadPublicApiClient } from '@/lib/api/lazyClient';

import type { PlatformStats } from '@aws-community-hub/shared';

const StatsSection = dynamic(() => import('./sections/StatsSection'), {
  loading: () => (
    <section className="py-16 bg-gray-100">
      <div className="container mx-auto px-4 text-center text-gray-600">Loading statistics...</div>
    </section>
  ),
  ssr: false,
});

export default function HomePageContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const router = useRouter();

  // Fetch platform statistics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const client = await loadPublicApiClient();
        const data = await client.getStats();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setStats(null);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-aws-blue to-gray-700 text-white py-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div className="text-center md:text-left">
              <h1 className="text-5xl font-bold mb-6">
                Discover AWS Community Content
              </h1>
              <p className="text-xl mb-8 text-gray-200">
                Search and track community-generated content from AWS contributors worldwide
              </p>

              {/* Search Bar */}
              <form onSubmit={handleSearch} className="max-w-3xl mx-auto md:mx-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Search for AWS content..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 px-6 py-4 rounded-lg text-gray-900 text-lg focus:ring-2 focus:ring-aws-orange"
                  />
                  <button
                    type="submit"
                    className="btn-primary px-8 py-4 text-lg"
                  >
                    Search
                  </button>
                </div>
              </form>
            </div>
            <div className="hidden md:block">
              <Image
                src="/images/community-hero.svg"
                alt="Community illustration"
                width={400}
                height={300}
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Platform Features</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 border rounded-lg hover:shadow-lg transition-shadow">
              <h3 className="text-xl font-bold mb-3 text-aws-orange-dark">Semantic Search</h3>
              <p className="text-gray-600">
                Find relevant content using AI-powered semantic search technology
              </p>
            </div>
            <div className="p-6 border rounded-lg hover:shadow-lg transition-shadow">
              <h3 className="text-xl font-bold mb-3 text-aws-orange-dark">Content Tracking</h3>
              <p className="text-gray-600">
                Automatically track content from blogs, YouTube, GitHub, and conferences
              </p>
            </div>
            <div className="p-6 border rounded-lg hover:shadow-lg transition-shadow">
              <h3 className="text-xl font-bold mb-3 text-aws-orange-dark">Community Profiles</h3>
              <p className="text-gray-600">
                Discover AWS Heroes, Community Builders, and Ambassadors
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section - Only show if data is available */}
      <StatsSection stats={stats} loading={statsLoading} />

      {/* Call to Action */}
      <section className="py-16 bg-aws-blue text-white text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-xl mb-8">
            Join thousands of AWS community contributors tracking their content
          </p>
          <a href="/auth/register" className="btn-primary text-lg px-8 py-4 inline-block">
            Create Free Account
          </a>
        </div>
      </section>
    </div>
  );
}
