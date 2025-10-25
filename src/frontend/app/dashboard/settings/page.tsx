'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { User, Visibility, SocialLinks } from '@shared/types';
import { loadAuthenticatedApiClient } from '@/lib/api/lazyClient';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Profile state
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [defaultVisibility, setDefaultVisibility] = useState<Visibility>(Visibility.PUBLIC);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState<{ score: number; label: string; color: string } | null>(null);
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [enablingMfa, setEnablingMfa] = useState(false);

  // Email preferences state
  const [receiveNewsletter, setReceiveNewsletter] = useState(false);
  const [receiveContentNotifications, setReceiveContentNotifications] = useState(true);
  const [receiveCommunityUpdates, setReceiveCommunityUpdates] = useState(true);
  const [preferencesSuccess, setPreferencesSuccess] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);

  // Data export state
  const [exportingData, setExportingData] = useState(false);

  // Account deletion state
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');

      if (!token) {
        setError('Unauthorized');
        setLoading(false);
        return;
      }

      const apiClient = await loadAuthenticatedApiClient();
      const userData = await apiClient.getCurrentUser();
      setUser(userData);
      setEmail(userData.email);
      setUsername(userData.username);
      setBio(userData.bio || /* istanbul ignore next */ '');
      setSocialLinks(userData.socialLinks || {});
      setDefaultVisibility(userData.defaultVisibility);

      // Initialize MFA status from user data
      setMfaEnabled(userData.mfaEnabled || /* istanbul ignore next */ false);

      // Initialize email preferences from user data
      setReceiveNewsletter(userData.receiveNewsletter || /* istanbul ignore next */ false);
      setReceiveContentNotifications(
        userData.receiveContentNotifications !== undefined
          ? userData.receiveContentNotifications
          : /* istanbul ignore next */ true
      );
      setReceiveCommunityUpdates(
        userData.receiveCommunityUpdates !== undefined
          ? userData.receiveCommunityUpdates
          : /* istanbul ignore next */ true
      );

      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    /* istanbul ignore next */
    if (!user) return;

    setSavingProfile(true);
    setProfileError('');
    setProfileSuccess('');

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setProfileError('Unauthorized');
      setSavingProfile(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      const updatedUser = await apiClient.updateUserProfile(user.id, {
        email: email.trim(),
        username,
        bio,
        defaultVisibility,
        socialLinks,
      });
      setUser(updatedUser);
      setEmail(updatedUser.email);
      setSocialLinks(updatedUser.socialLinks || {});
      const emailChanged = updatedUser.email !== user.email;
      setProfileSuccess(
        emailChanged
          ? 'Profile updated successfully. Please verify your new email address via the confirmation link we just sent.'
          : 'Profile updated successfully'
      );

      setTimeout(() => setProfileSuccess(''), 5000);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const validatePasswordStrength = (password: string): { isValid: boolean; message: string } => {
    if (password.length < 12) {
      return { isValid: false, message: 'Password must be at least 12 characters long' };
    }
    if (!/[A-Z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one lowercase letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one number' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)' };
    }
    return { isValid: true, message: 'Password is strong' };
  };

  const getPasswordStrength = (password: string): { score: number; label: string; color: string } => {
    if (!password) return { score: 0, label: '', color: '' };

    let score = 0;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;

    if (score <= 2) return { score, label: 'Weak', color: 'text-red-600' };
    if (score <= 4) return { score, label: 'Medium', color: 'text-yellow-600' };
    return { score, label: 'Strong', color: 'text-green-600' };
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    /* istanbul ignore next */
    if (!user) return;

    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.isValid) {
      setPasswordError(validation.message);
      return;
    }

    setChangingPassword(true);
    setPasswordError('');
    setPasswordSuccess('');

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setPasswordError('Unauthorized');
      setChangingPassword(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      await apiClient.changePassword(user.id, {
        currentPassword,
        newPassword,
      });

      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');

      setTimeout(() => setPasswordSuccess(''), 5000);
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleEnableMfa = async () => {
    /* istanbul ignore next */
    if (!user) return;

    setEnablingMfa(true);

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setPasswordError('Unauthorized');
      setEnablingMfa(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      const data = await apiClient.setupMfa(user.id);
      setMfaQrCode(data.qrCode);
      setMfaSecret(data.secret);
      setMfaEnabled(true);
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setEnablingMfa(false);
    }
  };

  const handleSavePreferences = async () => {
    /* istanbul ignore next */
    if (!user) return;

    setSavingPreferences(true);
    setPreferencesSuccess('');

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setProfileError('Unauthorized');
      setSavingPreferences(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      await apiClient.updatePreferences(user.id, {
        receiveNewsletter,
        receiveContentNotifications,
        receiveCommunityUpdates,
      });

      setPreferencesSuccess('Preferences updated successfully');

      setTimeout(() => setPreferencesSuccess(''), 5000);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleExportData = async () => {
    /* istanbul ignore next */
    if (!user) return;

    setExportingData(true);

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setProfileError('Unauthorized');
      setExportingData(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      const data = await apiClient.exportUserData(user.id);

      // Create and download JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `user-data-${user.username}-${new Date().toISOString()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setExportingData(false);
    }
  };

  const handleDeleteAccount = async () => {
    /* istanbul ignore next */
    if (!user) return;

    const confirmed = confirm(
      'Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently deleted.'
    );

    if (!confirmed) return;

    setDeletingAccount(true);
    setDeleteError('');

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setDeleteError('Unauthorized');
      setDeletingAccount(false);
      return;
    }

    try {
      const apiClient = await loadAuthenticatedApiClient();
      await apiClient.deleteAccount(user.id);

      // Clear tokens and redirect
      localStorage.removeItem('accessToken');
      localStorage.removeItem('idToken');
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('idToken');

      router.push('/');
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeletingAccount(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        {/* Profile Section */}
        <section className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Profile</h2>

          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Updating your email will trigger a verification email to confirm the change.
              </p>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-gray-700">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="defaultVisibility" className="block text-sm font-medium text-gray-700">
                Default Visibility
              </label>
              <select
                id="defaultVisibility"
                value={defaultVisibility}
                onChange={(e) => setDefaultVisibility(e.target.value as Visibility)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value={Visibility.PRIVATE}>Private</option>
                <option value={Visibility.AWS_ONLY}>AWS Only</option>
                <option value={Visibility.AWS_COMMUNITY}>AWS Community</option>
                <option value={Visibility.PUBLIC}>Public</option>
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="social-twitter" className="block text-sm font-medium text-gray-700">
                  Twitter URL
                </label>
                <input
                  type="url"
                  id="social-twitter"
                  value={socialLinks.twitter ?? ''}
                  onChange={(e) => setSocialLinks(prev => ({ ...prev, twitter: e.target.value }))}
                  placeholder="https://twitter.com/your-handle"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="social-linkedin" className="block text-sm font-medium text-gray-700">
                  LinkedIn URL
                </label>
                <input
                  type="url"
                  id="social-linkedin"
                  value={socialLinks.linkedin ?? ''}
                  onChange={(e) => setSocialLinks(prev => ({ ...prev, linkedin: e.target.value }))}
                  placeholder="https://linkedin.com/in/you"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="social-github" className="block text-sm font-medium text-gray-700">
                  GitHub URL
                </label>
                <input
                  type="url"
                  id="social-github"
                  value={socialLinks.github ?? ''}
                  onChange={(e) => setSocialLinks(prev => ({ ...prev, github: e.target.value }))}
                  placeholder="https://github.com/you"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="social-website" className="block text-sm font-medium text-gray-700">
                  Website URL
                </label>
                <input
                  type="url"
                  id="social-website"
                  value={socialLinks.website ?? ''}
                  onChange={(e) => setSocialLinks(prev => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>

            {profileError && (
              <div className="text-red-600 text-sm">{profileError}</div>
            )}

            {profileSuccess && (
              <div className="text-green-600 text-sm">{profileSuccess}</div>
            )}

            <button
              type="submit"
              disabled={savingProfile}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </section>

        {/* Security Section */}
        <section className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Security</h2>

          {/* Password Change */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Change Password</h3>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
                  Current Password
                </label>
                <input
                  type="password"
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  New Password
                </label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => {
                    const pwd = e.target.value;
                    setNewPassword(pwd);
                    if (pwd) {
                      setPasswordStrength(getPasswordStrength(pwd));
                    } else {
                      setPasswordStrength(null);
                    }
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
                {passwordStrength && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">Password Strength:</span>
                      <span className={`text-xs font-semibold ${passwordStrength.color}`}>
                        {passwordStrength.label}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          passwordStrength.score <= 2 ? 'bg-red-500' :
                          passwordStrength.score <= 4 ? 'bg-yellow-500' :
                          'bg-green-500'
                        }`}
                        style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                    {passwordStrength.score < 6
                      ? 'Use at least 12 characters with uppercase, lowercase, numbers, and special characters'
                      : /* istanbul ignore next */ 'Strong password!'}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-gray-700">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  id="confirmNewPassword"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              {passwordError && (
                <div className="text-red-600 text-sm">{passwordError}</div>
              )}

              {passwordSuccess && (
                <div className="text-green-600 text-sm">{passwordSuccess}</div>
              )}

              <button
                type="submit"
                disabled={changingPassword}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>

          {/* MFA Setup */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Multi-Factor Authentication</h3>

            {!mfaQrCode ? (
              <button
                onClick={handleEnableMfa}
                disabled={enablingMfa}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {enablingMfa ? 'Enabling...' : 'Enable MFA'}
              </button>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-2">Scan this QR code with your authenticator app:</p>
                <Image
                  src={mfaQrCode}
                  alt="MFA QR Code"
                  width={192}
                  height={192}
                  className="w-48 h-48"
                  unoptimized
                />
                <p className="text-xs text-gray-500 mt-2">Secret: {mfaSecret}</p>
              </div>
            )}
          </div>
        </section>

        {/* Privacy Section */}
        <section className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Privacy</h2>

          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Email Preferences</h3>

            <div className="space-y-3">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="receiveNewsletter"
                  checked={receiveNewsletter}
                  onChange={(e) => setReceiveNewsletter(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="receiveNewsletter" className="ml-2 block text-sm text-gray-700">
                  Receive Newsletter
                </label>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="receiveContentNotifications"
                  checked={receiveContentNotifications}
                  onChange={(e) => setReceiveContentNotifications(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="receiveContentNotifications" className="ml-2 block text-sm text-gray-700">
                  Receive Content Notifications
                </label>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="receiveCommunityUpdates"
                  checked={receiveCommunityUpdates}
                  onChange={(e) => setReceiveCommunityUpdates(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="receiveCommunityUpdates" className="ml-2 block text-sm text-gray-700">
                  Receive Community Updates
                </label>
              </div>
            </div>

            {preferencesSuccess && (
              <div className="text-green-600 text-sm mt-4">{preferencesSuccess}</div>
            )}

            <button
              onClick={handleSavePreferences}
              disabled={savingPreferences}
              className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {savingPreferences ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </section>

        {/* Data Section */}
        <section className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Data</h2>

          {/* Data Export */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Export Your Data</h3>
            <p className="text-sm text-gray-600 mb-4">
              Download a copy of all your data including profile, content, and badges.
            </p>

            <button
              onClick={handleExportData}
              disabled={exportingData}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {exportingData ? 'Exporting...' : 'Export My Data'}
            </button>
          </div>

          {/* Account Deletion */}
          <div className="border-t pt-8">
            <h3 className="text-lg font-medium text-red-600 mb-2">Delete Account</h3>
            <p className="text-sm text-gray-600 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="text-red-600 text-sm mb-4">{deleteError}</div>
            )}

            <button
              onClick={handleDeleteAccount}
              disabled={deletingAccount}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {deletingAccount ? 'Deleting...' : 'Delete My Account'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
