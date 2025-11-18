'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoginRequest, LoginResponse } from '@aws-community-hub/shared';
import { getPublicApiClient } from '@/api/client';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const client = getPublicApiClient();
      const requestBody: LoginRequest = {
        email: formData.email,
        password: formData.password,
      };
      const data: LoginResponse = await client.login(requestBody);
      // Store tokens based on "Remember Me" preference
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem('accessToken', data.accessToken);
      storage.setItem('idToken', data.idToken);
      storage.setItem('refreshToken', data.refreshToken);

      // Redirect to dashboard or home
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-6 text-aws-blue">Login</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">Email</label>
            <input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="input-field"
              placeholder="your.email@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">Password</label>
            <input
              id="password"
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="input-field"
              placeholder="Enter your password"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="mr-2"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span className="text-sm">Remember me</span>
            </label>
            <a href="/auth/forgot-password" className="text-sm text-aws-orange hover:underline">
              Forgot password?
            </a>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don&rsquo;t have an account?{' '}
            <a href="/auth/register" className="text-aws-orange hover:underline font-medium">
              Register here
            </a>
          </p>
        </div>

        <div className="mt-8 pt-6 border-t">
          <p className="text-sm text-gray-600 text-center mb-4">Or login with</p>
          <div className="space-y-2">
            <button className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
              <span>Continue with Google</span>
            </button>
            <button className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
              <span>Continue with GitHub</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
