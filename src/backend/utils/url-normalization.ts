/**
 * URL Normalization Utility
 * Normalizes URLs to improve duplicate detection accuracy
 */

/**
 * Normalize a URL for comparison purposes
 *
 * Normalization steps:
 * 1. Convert to lowercase
 * 2. Force HTTPS protocol
 * 3. Remove www subdomain
 * 4. Remove trailing slashes
 * 5. Remove default ports (80 for HTTP, 443 for HTTPS)
 * 6. Sort query parameters alphabetically
 * 7. Remove common tracking parameters
 * 8. Remove URL fragments (#)
 *
 * @param urlString - The URL to normalize
 * @returns Normalized URL string, or null if invalid
 */
export function normalizeUrl(urlString: string | null | undefined): string | null {
  if (!urlString) {
    return null;
  }

  try {
    // Trim whitespace
    const trimmed = urlString.trim();
    if (!trimmed) {
      return null;
    }

    // Parse URL
    const url = new URL(trimmed);

    // 1. Force HTTPS (treat http and https as equivalent)
    url.protocol = 'https:';

    // 2. Convert hostname to lowercase and remove www
    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    url.hostname = hostname;

    // 3. Remove default ports
    if (url.port === '443' || url.port === '80') {
      url.port = '';
    }

    // 4. Normalize pathname - remove trailing slash (except for root)
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname;

    // 5. Sort query parameters alphabetically
    const params = Array.from(url.searchParams.entries())
      // Remove common tracking parameters
      .filter(([key]) => !isTrackingParameter(key))
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Rebuild search params
    url.search = '';
    params.forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    // 6. Remove fragment
    url.hash = '';

    // Return normalized URL
    return url.toString();
  } catch (error) {
    // Invalid URL
    console.warn('Failed to normalize URL:', urlString, error);
    return null;
  }
}

/**
 * Check if a query parameter is a tracking parameter that should be removed
 */
function isTrackingParameter(key: string): boolean {
  const trackingParams = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'fbclid',
    'gclid',
    'msclkid',
    'mc_cid',
    'mc_eid',
    '_ga',
    'ref',
  ];

  return trackingParams.includes(key.toLowerCase());
}

/**
 * Batch normalize multiple URLs
 * Returns a map of original URL to normalized URL
 */
export function normalizeUrls(urls: string[]): Map<string, string | null> {
  const normalized = new Map<string, string | null>();

  for (const url of urls) {
    normalized.set(url, normalizeUrl(url));
  }

  return normalized;
}

/**
 * Compare two URLs for equality after normalization
 */
export function urlsAreEqual(url1: string | null | undefined, url2: string | null | undefined): boolean {
  const normalized1 = normalizeUrl(url1);
  const normalized2 = normalizeUrl(url2);

  if (!normalized1 || !normalized2) {
    return false;
  }

  return normalized1 === normalized2;
}
