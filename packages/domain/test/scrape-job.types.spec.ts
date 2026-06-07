import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_SCRAPE_PROXY_LENGTH,
  InvalidScrapeProxyError,
  InvalidScrapeUrlError,
  MAX_SCRAPE_URL_LENGTH,
  normalizeAndValidateScrapeProxy,
  normalizeAndValidateScrapeUrl,
} from '../src/lib/scrape-job.types.js';

describe('normalizeAndValidateScrapeUrl', () => {
  it('trims and accepts valid http and https URLs', () => {
    expect(
      normalizeAndValidateScrapeUrl('  https://example.com/path?q=1  '),
    ).toBe('https://example.com/path?q=1');
    expect(normalizeAndValidateScrapeUrl('http://example.com')).toBe(
      'http://example.com',
    );
  });

  it('rejects non-string and empty values', () => {
    for (const value of [undefined, null, 123, '   ']) {
      expect(() => normalizeAndValidateScrapeUrl(value)).toThrow(
        InvalidScrapeUrlError,
      );
    }
  });

  it('rejects URLs longer than the configured limit', () => {
    const prefix = 'https://example.com/';
    const tooLongUrl =
      prefix + 'a'.repeat(MAX_SCRAPE_URL_LENGTH - prefix.length + 1);

    expect(() => normalizeAndValidateScrapeUrl(tooLongUrl)).toThrow(
      `url must not exceed ${MAX_SCRAPE_URL_LENGTH} characters`,
    );
  });

  it('rejects invalid absolute URLs, unsupported protocols, and embedded credentials', () => {
    for (const value of [
      'not-a-url',
      'ftp://example.com/resource',
      'https://user:pass@example.com',
    ]) {
      expect(() => normalizeAndValidateScrapeUrl(value)).toThrow(
        InvalidScrapeUrlError,
      );
    }
  });
});

describe('normalizeAndValidateScrapeProxy', () => {
  it('trims and accepts valid http and https proxy URLs', () => {
    expect(
      normalizeAndValidateScrapeProxy('  http://proxy.example.com:8080  '),
    ).toBe('http://proxy.example.com:8080');
    expect(
      normalizeAndValidateScrapeProxy(
        'https://user:pass@secure-proxy.example.com:8443',
      ),
    ).toBe('https://user:pass@secure-proxy.example.com:8443');
  });

  it('rejects non-string and empty values', () => {
    for (const value of [undefined, null, 123, '   ']) {
      expect(() => normalizeAndValidateScrapeProxy(value)).toThrow(
        InvalidScrapeProxyError,
      );
    }
  });

  it('rejects proxies longer than the configured limit', () => {
    const prefix = 'http://proxy.example.com/';
    const tooLongProxy =
      prefix + 'a'.repeat(DEFAULT_MAX_SCRAPE_PROXY_LENGTH - prefix.length + 1);

    expect(() => normalizeAndValidateScrapeProxy(tooLongProxy)).toThrow(
      `proxy must not exceed ${DEFAULT_MAX_SCRAPE_PROXY_LENGTH} characters`,
    );
  });

  it('rejects invalid absolute proxy URLs and unsupported protocols', () => {
    for (const value of ['not-a-url', 'ftp://proxy.example.com:8080']) {
      expect(() => normalizeAndValidateScrapeProxy(value)).toThrow(
        InvalidScrapeProxyError,
      );
    }
  });
});