/**
 * IP Address Anonymization Utility
 * GDPR-compliant IP anonymization for analytics
 *
 * References:
 * - GDPR Article 4(5) - Pseudonymisation
 * - Google Analytics IP Anonymization
 * - AWS CloudFront Log Anonymization best practices
 */

/**
 * Anonymize an IP address for GDPR compliance
 *
 * IPv4: Zeros out the last octet (e.g., 192.168.1.100 -> 192.168.1.0)
 * IPv6: Zeros out the last 80 bits, keeping first 48 bits (network prefix)
 *
 * This reduces precision while maintaining useful geographic/network information
 * for analytics purposes while protecting individual user privacy.
 *
 * @param ipAddress - The IP address to anonymize
 * @returns Anonymized IP address, or null if invalid
 */
export function anonymizeIp(ipAddress: string | null | undefined): string | null {
  if (!ipAddress) {
    return null;
  }

  const trimmed = ipAddress.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // Check if IPv6
    if (trimmed.includes(':')) {
      return anonymizeIpv6(trimmed);
    }

    // Assume IPv4
    return anonymizeIpv4(trimmed);
  } catch (error) {
    console.warn('Failed to anonymize IP address:', ipAddress, error);
    // Return null rather than raw IP on error (fail-safe for privacy)
    return null;
  }
}

/**
 * Anonymize IPv4 address by zeroing the last octet
 * Example: 192.168.1.100 -> 192.168.1.0
 */
function anonymizeIpv4(ip: string): string | null {
  const parts = ip.split('.');

  if (parts.length !== 4) {
    return null;
  }

  // Validate each octet
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return null;
    }
  }

  // Zero out the last octet
  parts[3] = '0';

  return parts.join('.');
}

/**
 * Anonymize IPv6 address by keeping only the first 48 bits (3 groups of 16 bits)
 * Example: 2001:0db8:85a3:0000:0000:8a2e:0370:7334 -> 2001:0db8:85a3::
 *
 * This keeps the network routing prefix while removing the interface identifier
 * which could be used to identify individual users.
 */
function anonymizeIpv6(ip: string): string | null {
  try {
    // Expand abbreviated IPv6 (handle ::)
    const expanded = expandIpv6(ip);
    if (!expanded) {
      return null;
    }

    // Split into 8 groups of 16 bits each
    const groups = expanded.split(':');
    if (groups.length !== 8) {
      return null;
    }

    // Keep only first 3 groups (48 bits) and zero out the rest
    const anonymized = groups.slice(0, 3).join(':') + '::';

    return anonymized;
  } catch (error) {
    return null;
  }
}

/**
 * Expand abbreviated IPv6 address to full form
 * Example: 2001:db8::1 -> 2001:0db8:0000:0000:0000:0000:0000:0001
 */
function expandIpv6(ip: string): string | null {
  // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
  if (ip.includes('.')) {
    // For simplicity, treat as IPv4
    return null;
  }

  // Split on ::
  const sides = ip.split('::');

  if (sides.length > 2) {
    // Invalid: more than one ::
    return null;
  }

  let groups: string[];

  if (sides.length === 2) {
    // Expansion needed
    const leftGroups = sides[0] ? sides[0].split(':') : [];
    const rightGroups = sides[1] ? sides[1].split(':') : [];

    // Calculate number of zero groups needed
    const totalGroups = 8;
    const zeroGroups = totalGroups - leftGroups.length - rightGroups.length;

    if (zeroGroups < 0) {
      return null;
    }

    // Build expanded groups
    groups = [
      ...leftGroups,
      ...Array(zeroGroups).fill('0000'),
      ...rightGroups,
    ];
  } else {
    // No expansion needed
    groups = ip.split(':');
  }

  if (groups.length !== 8) {
    return null;
  }

  // Pad each group to 4 hex digits
  groups = groups.map((group) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      throw new Error('Invalid hex group');
    }
    return group.padStart(4, '0');
  });

  return groups.join(':');
}

/**
 * Check if an IP address is a private/internal address
 * Private IPs don't need the same level of anonymization since they're not
 * globally routable, but we still anonymize them for consistency.
 */
export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) {
    return false;
  }

  // IPv4 private ranges
  const privateV4Ranges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,  // Loopback
  ];

  if (ip.includes('.')) {
    return privateV4Ranges.some((range) => range.test(ip));
  }

  // IPv6 private ranges
  if (ip.includes(':')) {
    return (
      ip.startsWith('fe80:') ||  // Link-local
      ip.startsWith('fc') ||      // Unique local
      ip.startsWith('fd') ||      // Unique local
      ip === '::1'                // Loopback
    );
  }

  return false;
}
