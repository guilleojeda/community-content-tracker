import { anonymizeIp, isPrivateIp } from '../../../src/backend/utils/ip-anonymization';

describe('IP Anonymization Utility', () => {
  describe('anonymizeIp - IPv4', () => {
    it('should anonymize standard IPv4 addresses', () => {
      expect(anonymizeIp('192.168.1.100')).toBe('192.168.1.0');
      expect(anonymizeIp('10.0.0.255')).toBe('10.0.0.0');
      expect(anonymizeIp('172.16.254.1')).toBe('172.16.254.0');
      expect(anonymizeIp('8.8.8.8')).toBe('8.8.8.0');
    });

    it('should anonymize public IPv4 addresses', () => {
      expect(anonymizeIp('203.0.113.45')).toBe('203.0.113.0');
      expect(anonymizeIp('198.51.100.178')).toBe('198.51.100.0');
      expect(anonymizeIp('1.1.1.1')).toBe('1.1.1.0');
    });

    it('should handle IPv4 addresses with last octet already zero', () => {
      expect(anonymizeIp('192.168.1.0')).toBe('192.168.1.0');
      expect(anonymizeIp('10.0.0.0')).toBe('10.0.0.0');
    });

    it('should return null for invalid IPv4 addresses', () => {
      expect(anonymizeIp('256.1.1.1')).toBeNull();
      expect(anonymizeIp('192.168.1')).toBeNull();
      expect(anonymizeIp('192.168.1.1.1')).toBeNull();
      expect(anonymizeIp('abc.def.ghi.jkl')).toBeNull();
    });
  });

  describe('anonymizeIp - IPv6', () => {
    it('should anonymize standard IPv6 addresses', () => {
      expect(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3::');
      expect(anonymizeIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:0db8:85a3::');
    });

    it('should anonymize compressed IPv6 addresses', () => {
      expect(anonymizeIp('2001:db8::1')).toBe('2001:0db8:0000::');
      expect(anonymizeIp('2001:db8::')).toBe('2001:0db8:0000::');
      expect(anonymizeIp('::1')).toBe('0000:0000:0000::');
    });

    it('should anonymize full IPv6 addresses', () => {
      expect(anonymizeIp('fe80:0000:0000:0000:0202:b3ff:fe1e:8329')).toBe('fe80:0000:0000::');
    });

    it('should handle IPv6 with leading zeros', () => {
      expect(anonymizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:0db8:0000::');
    });

    it('should return null for invalid IPv6 addresses', () => {
      expect(anonymizeIp('gggg::')).toBeNull();
      expect(anonymizeIp('2001:db8:::1')).toBeNull();  // Double ::
      expect(anonymizeIp('2001:db8:85a3:0000:0000:8a2e:0370:7334:extra')).toBeNull();  // Too many groups
    });
  });

  describe('anonymizeIp - Edge Cases', () => {
    it('should return null for null, undefined, or empty strings', () => {
      expect(anonymizeIp(null)).toBeNull();
      expect(anonymizeIp(undefined)).toBeNull();
      expect(anonymizeIp('')).toBeNull();
      expect(anonymizeIp('   ')).toBeNull();
    });

    it('should handle IP addresses with whitespace', () => {
      expect(anonymizeIp('  192.168.1.100  ')).toBe('192.168.1.0');
      expect(anonymizeIp('  2001:db8::1  ')).toBe('2001:0db8:0000::');
    });

    it('should fail safely by returning null for invalid inputs', () => {
      expect(anonymizeIp('not-an-ip')).toBeNull();
      expect(anonymizeIp('...')).toBeNull();
      expect(anonymizeIp('192.168.1')).toBeNull();
    });
  });

  describe('anonymizeIp - GDPR Compliance Verification', () => {
    it('should remove sufficient precision from IPv4 to prevent individual identification', () => {
      const original = '203.0.113.45';
      const anonymized = anonymizeIp(original);

      // Should not match original
      expect(anonymized).not.toBe(original);

      // Should keep network portion (first 3 octets)
      expect(anonymized).toContain('203.0.113');

      // Should remove host portion (last octet)
      expect(anonymized).toMatch(/\.0$/);
    });

    it('should remove sufficient precision from IPv6 to prevent individual identification', () => {
      const original = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      const anonymized = anonymizeIp(original);

      // Should not match original
      expect(anonymized).not.toBe(original);

      // Should keep network prefix (first 48 bits)
      expect(anonymized).toBe('2001:0db8:85a3::');

      // Should end with :: indicating zeroed interface identifier
      expect(anonymized).toMatch(/::$/);
    });

    it('should consistently anonymize the same IP address', () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.100';

      expect(anonymizeIp(ip1)).toBe(anonymizeIp(ip2));
    });

    it('should produce different anonymized IPs for different source IPs in same network', () => {
      // Different hosts in different networks should have different anonymized IPs
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.2.100';

      expect(anonymizeIp(ip1)).not.toBe(anonymizeIp(ip2));
      expect(anonymizeIp(ip1)).toBe('192.168.1.0');
      expect(anonymizeIp(ip2)).toBe('192.168.2.0');
    });
  });

  describe('isPrivateIp', () => {
    it('should identify private IPv4 addresses', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      expect(isPrivateIp('127.0.0.1')).toBe(true);
    });

    it('should identify public IPv4 addresses', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
      expect(isPrivateIp('203.0.113.1')).toBe(false);
      expect(isPrivateIp('172.15.0.1')).toBe(false);  // Not in private range
      expect(isPrivateIp('172.32.0.1')).toBe(false);  // Not in private range
    });

    it('should identify private IPv6 addresses', () => {
      expect(isPrivateIp('fe80::1')).toBe(true);  // Link-local
      expect(isPrivateIp('fc00::1')).toBe(true);  // Unique local
      expect(isPrivateIp('fd00::1')).toBe(true);  // Unique local
      expect(isPrivateIp('::1')).toBe(true);      // Loopback
    });

    it('should identify public IPv6 addresses', () => {
      expect(isPrivateIp('2001:db8::1')).toBe(false);
      expect(isPrivateIp('2001:0db8:85a3::8a2e:370:7334')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isPrivateIp(null)).toBe(false);
      expect(isPrivateIp(undefined)).toBe(false);
      expect(isPrivateIp('')).toBe(false);
    });
  });

  describe('Real-world Examples', () => {
    it('should anonymize AWS ALB client IPs', () => {
      // Typical AWS Application Load Balancer client IP
      expect(anonymizeIp('54.239.28.85')).toBe('54.239.28.0');
    });

    it('should anonymize CloudFront viewer IPs', () => {
      // CloudFront viewer IP example
      expect(anonymizeIp('52.46.134.117')).toBe('52.46.134.0');
    });

    it('should anonymize IPv6 from modern ISPs', () => {
      // Modern ISP IPv6 assignment
      expect(anonymizeIp('2606:2800:220:1:248:1893:25c8:1946')).toBe('2606:2800:0220::');
    });

    it('should handle localhost addresses', () => {
      expect(anonymizeIp('127.0.0.1')).toBe('127.0.0.0');
      expect(anonymizeIp('::1')).toBe('0000:0000:0000::');
    });
  });
});
