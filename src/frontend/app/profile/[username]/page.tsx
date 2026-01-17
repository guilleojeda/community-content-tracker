import type { Metadata } from 'next';
import fs from 'fs';
import path from 'path';
import ProfilePageClient from './ProfilePageClient';

export const metadata: Metadata = {
  title: 'AWS Community Hub - Profile',
  description: 'View AWS community contributor profiles and contributions.',
};

export const dynamicParams = true;

const parseProfileUsernames = (raw?: string): string[] => {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const parseProfileFileContents = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value)).filter((value) => value.length > 0);
    }
    if (parsed && Array.isArray((parsed as { usernames?: unknown }).usernames)) {
      return (parsed as { usernames: unknown[] }).usernames
        .map((value) => String(value))
        .filter((value) => value.length > 0);
    }
  } catch {
    // Fall through to delimiter-based parsing.
  }

  return parseProfileUsernames(trimmed.replace(/\r?\n/g, ','));
};

const normalizeProjectName = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

const resolveLocalApiUsernames = (): string[] => {
  const rawProjects = process.env.LOCAL_API_PROJECTS;
  const projects = parseProfileUsernames(rawProjects);
  if (projects.length === 0) {
    return [];
  }

  const usernames = new Set<string>();
  projects.forEach((project) => {
    const slug = normalizeProjectName(project);
    if (!slug) {
      return;
    }
    usernames.add(`creator-${slug}`);
    usernames.add(`builder-${slug}`);
    usernames.add(`admin-${slug}`);
  });

  return Array.from(usernames);
};

const resolveStaticProfileUsernames = (): string[] => {
  const fileHint =
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES_FILE || process.env.STATIC_PROFILE_USERNAMES_FILE;
  const candidateFiles = [
    fileHint && fileHint.trim().length > 0 ? fileHint.trim() : null,
    'static-profile-usernames.json',
  ].filter(Boolean) as string[];

  for (const candidate of candidateFiles) {
    const resolvedPath = path.isAbsolute(candidate)
      ? candidate
      : path.join(process.cwd(), candidate);
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    try {
      const contents = fs.readFileSync(resolvedPath, 'utf8');
      const usernames = parseProfileFileContents(contents);
      if (usernames.length > 0) {
        return usernames;
      }
    } catch (error) {
      console.warn('Failed to read static profile usernames file:', error);
    }
  }

  return [];
};

export function generateStaticParams(): Array<{ username: string }> {
  const fileUsernames = resolveStaticProfileUsernames();
  const envList = process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES || process.env.STATIC_PROFILE_USERNAMES;
  const envUsernames = parseProfileUsernames(envList);
  const localApiUsernames = resolveLocalApiUsernames();
  const usernames = Array.from(new Set([...fileUsernames, ...envUsernames, ...localApiUsernames]));
  if (usernames.length > 0) {
    return usernames.map((username) => ({ username }));
  }

  console.warn('No static profile usernames configured; profile pages will not be pre-rendered.');
  return [];
}

export default function ProfilePage({ params }: { params: { username: string } }): JSX.Element {
  return <ProfilePageClient initialUsername={params.username} />;
}
