import type { ImageLoaderProps } from 'next/image';

const DEFAULT_QUALITY = 75;

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '');

export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  const normalizedQuality = quality ?? DEFAULT_QUALITY;
  const normalizedSrc = src.startsWith('/') ? src : `/${src}`;
  const cdnBase = process.env.NEXT_PUBLIC_IMAGE_CDN_URL;

  if (cdnBase && cdnBase.trim().length > 0) {
    const base = normalizeBaseUrl(cdnBase.trim());
    const params = new URLSearchParams({
      w: String(width),
      q: String(normalizedQuality),
    });
    return `${base}${normalizedSrc}?${params.toString()}`;
  }

  const separator = normalizedSrc.includes('?') ? '&' : '?';
  return `${normalizedSrc}${separator}w=${width}&q=${normalizedQuality}`;
}
