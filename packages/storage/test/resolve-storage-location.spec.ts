import { describe, expect, it } from 'vitest';

import { resolveStorageLocation } from '../src/lib/storage.js';

describe('resolveStorageLocation', () => {
  it('throws when the completed job storage path is missing', () => {
    expect(() => resolveStorageLocation(undefined, 'scrape-results')).toThrow(
      'Completed job is missing its storage path.',
    );
  });

  it('parses an s3 uri into bucket and key', () => {
    expect(
      resolveStorageLocation('s3://scrape-results/path/to/result.html', undefined),
    ).toEqual({
      bucket: 'scrape-results',
      key: 'path/to/result.html',
    });
  });

  it('rejects malformed s3 uris', () => {
    for (const value of [
      's3://missing-key',
      's3:///missing-bucket',
      's3://scrape-results/',
    ]) {
      expect(() => resolveStorageLocation(value, undefined)).toThrow(
        `Invalid storage path: ${value}`,
      );
    }
  });

  it('uses the default bucket for plain keys', () => {
    expect(
      resolveStorageLocation('jobs/job-1/result.html', 'scrape-results'),
    ).toEqual({
      bucket: 'scrape-results',
      key: 'jobs/job-1/result.html',
    });
  });

  it('parses bucket-prefixed keys when no default bucket is configured', () => {
    expect(
      resolveStorageLocation('scrape-results/jobs/job-1/result.html', undefined),
    ).toEqual({
      bucket: 'scrape-results',
      key: 'jobs/job-1/result.html',
    });
  });

  it('returns only the key for bare relative paths without bucket context', () => {
    expect(resolveStorageLocation('result.html', undefined)).toEqual({
      key: 'result.html',
    });
  });
});