import { randomUUID } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  S3StorageService,
  StorageObjectMissingError,
} from '../src/lib/storage.js';

const missingEnv = ['S3_DEFAULT_BUCKET'].filter(
  (name) => !process.env[name]?.trim(),
);

describe.skipIf(missingEnv.length > 0)(
  'S3StorageService integration',
  { concurrent: false },
  () => {
    const createdObjects = new Set<string>();

    afterEach(async () => {
      await Promise.all(
        Array.from(createdObjects, async (key) => {
          await createStorageService().deleteObject({ key });
          createdObjects.delete(key);
        }),
      );
    });

    it('stores, reads, and deletes an object against S3', async () => {
      const storage = createStorageService();
      const key = `storage-integration/${randomUUID()}.txt`;
      const body = `storage round trip ${randomUUID()}`;

      createdObjects.add(key);

      const stored = await storage.putText({
        key,
        body,
        contentType: 'text/plain; charset=utf-8',
      });

      expect(stored.bucket).toBe(readDefaultBucket());
      expect(stored.key).toBe(key);

      await expect(storage.assertObjectExists({ key })).resolves.toBeUndefined();

      const object = await storage.getObject({ key });

      expect(object.bucket).toBe(readDefaultBucket());
      expect(object.key).toBe(key);
      expect(object.contentType).toContain('text/plain');
      await expect(readStreamBody(object.body)).resolves.toBe(body);

      await storage.deleteObject({ key });
      createdObjects.delete(key);

      await expect(storage.assertObjectExists({ key })).rejects.toBeInstanceOf(
        StorageObjectMissingError,
      );
    });
  },
);

function createStorageService(): S3StorageService {
  return new S3StorageService(
    new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
      credentials: buildCredentials(),
    }),
    {
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
      credentials: buildCredentials(),
      defaultBucket: readDefaultBucket(),
    },
  );
}

function buildCredentials() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return undefined;
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

function readDefaultBucket(): string {
  const bucket = process.env.S3_DEFAULT_BUCKET;

  if (!bucket) {
    throw new Error('S3_DEFAULT_BUCKET is required for storage integration tests.');
  }

  return bucket;
}

function readBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return defaultValue;
}

async function readStreamBody(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
}