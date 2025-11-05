import { normalizeUrl, urlsAreEqual, normalizeUrls } from '../../../src/backend/utils/url-normalization';

describe('URL Normalization Utility', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('normalizeUrl', () => {
    it('should normalize HTTP to HTTPS', () => {
      expect(normalizeUrl('http://example.com')).toBe('https://example.com/');
      expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    });

    it('should remove www subdomain', () => {
      expect(normalizeUrl('https://www.example.com')).toBe('https://example.com/');
      expect(normalizeUrl('http://www.example.com/page')).toBe('https://example.com/page');
    });

    it('should remove trailing slashes from paths (except root)', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
      expect(normalizeUrl('https://example.com/path/subpath/')).toBe('https://example.com/path/subpath');
    });

    it('should convert hostname to lowercase', () => {
      expect(normalizeUrl('https://EXAMPLE.COM')).toBe('https://example.com/');
      expect(normalizeUrl('https://Example.Com/Path')).toBe('https://example.com/Path');
    });

    it('should remove default ports', () => {
      expect(normalizeUrl('https://example.com:443')).toBe('https://example.com/');
      expect(normalizeUrl('http://example.com:80')).toBe('https://example.com/');
      expect(normalizeUrl('https://example.com:8080')).toBe('https://example.com:8080/');
    });

    it('should sort query parameters alphabetically', () => {
      const url = normalizeUrl('https://example.com?z=3&a=1&m=2');
      expect(url).toBe('https://example.com/?a=1&m=2&z=3');
    });

    it('should remove tracking parameters', () => {
      const url = normalizeUrl('https://example.com?utm_source=twitter&utm_campaign=spring&id=123');
      expect(url).toBe('https://example.com/?id=123');

      const url2 = normalizeUrl('https://example.com?fbclid=xyz&gclid=abc&page=1');
      expect(url2).toBe('https://example.com/?page=1');
    });

    it('should remove URL fragments', () => {
      expect(normalizeUrl('https://example.com#section')).toBe('https://example.com/');
      expect(normalizeUrl('https://example.com/page#top')).toBe('https://example.com/page');
    });

    it('should handle complex URLs with multiple normalizations', () => {
      const input = 'http://www.Example.com:80/Path/?utm_source=test&z=3&a=1#section';
      const expected = 'https://example.com/Path?a=1&z=3';
      expect(normalizeUrl(input)).toBe(expected);
    });

    it('should return null for invalid URLs', () => {
      expect(normalizeUrl('not-a-url')).toBeNull();
      expect(normalizeUrl('')).toBeNull();
      expect(normalizeUrl('   ')).toBeNull();
      expect(normalizeUrl(null)).toBeNull();
      expect(normalizeUrl(undefined)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should handle URLs with special characters', () => {
      expect(normalizeUrl('https://example.com/path%20with%20spaces')).toBe(
        'https://example.com/path%20with%20spaces'
      );
    });

    it('should preserve query parameter values', () => {
      const url = normalizeUrl('https://example.com?search=hello+world&lang=en');
      expect(url).toContain('search=hello+world');
      expect(url).toContain('lang=en');
    });

    it('should handle multiple www prefixes', () => {
      // Edge case: what if someone has www.www.example.com?
      // We only remove the first www.
      expect(normalizeUrl('https://www.www.example.com')).toBe('https://www.example.com/');
    });
  });

  describe('urlsAreEqual', () => {
    it('should return true for equivalent URLs after normalization', () => {
      expect(urlsAreEqual('http://example.com', 'https://example.com')).toBe(true);
      expect(urlsAreEqual('http://www.example.com/', 'https://example.com')).toBe(true);
      expect(urlsAreEqual('https://example.com?a=1&b=2', 'https://example.com?b=2&a=1')).toBe(true);
    });

    it('should return false for different URLs', () => {
      expect(urlsAreEqual('https://example.com', 'https://different.com')).toBe(false);
      expect(urlsAreEqual('https://example.com/page1', 'https://example.com/page2')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(urlsAreEqual('invalid', 'https://example.com')).toBe(false);
      expect(urlsAreEqual(null, 'https://example.com')).toBe(false);
      expect(urlsAreEqual(undefined, undefined)).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should ignore tracking parameters when comparing', () => {
      const url1 = 'https://example.com?utm_source=twitter&id=123';
      const url2 = 'https://example.com?utm_campaign=spring&id=123';
      expect(urlsAreEqual(url1, url2)).toBe(true);
    });
  });

  describe('normalizeUrls', () => {
    it('should normalize multiple URLs', () => {
      const urls = ['http://example.com', 'https://www.example.com', 'https://test.com'];
      const normalized = normalizeUrls(urls);

      expect(normalized.size).toBe(3);
      expect(normalized.get('http://example.com')).toBe('https://example.com/');
      expect(normalized.get('https://www.example.com')).toBe('https://example.com/');
      expect(normalized.get('https://test.com')).toBe('https://test.com/');
    });

    it('should handle empty array', () => {
      const normalized = normalizeUrls([]);
      expect(normalized.size).toBe(0);
    });

    it('should handle invalid URLs in batch', () => {
      const urls = ['https://valid.com', 'invalid-url', 'https://another.com'];
      const normalized = normalizeUrls(urls);

      expect(normalized.size).toBe(3);
      expect(normalized.get('https://valid.com')).toBe('https://valid.com/');
      expect(normalized.get('invalid-url')).toBeNull();
      expect(normalized.get('https://another.com')).toBe('https://another.com/');
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to normalize URL:',
        'invalid-url',
        expect.anything()
      );
    });
  });

  describe('Real-world AWS URL examples', () => {
    it('should normalize AWS blog post URLs', () => {
      const url1 = 'https://aws.amazon.com/blogs/compute/example/?utm_source=feed';
      const url2 = 'http://www.aws.amazon.com/blogs/compute/example/';

      expect(urlsAreEqual(url1, url2)).toBe(true);
    });

    it('should normalize YouTube URLs', () => {
      const url1 = 'https://www.youtube.com/watch?v=abc123&utm_source=share';
      const url2 = 'https://youtube.com/watch?v=abc123';

      expect(urlsAreEqual(url1, url2)).toBe(true);
    });

    it('should normalize GitHub URLs', () => {
      const url1 = 'https://github.com/user/repo/';
      const url2 = 'http://www.github.com/user/repo';

      expect(urlsAreEqual(url1, url2)).toBe(true);
    });
  });
});
