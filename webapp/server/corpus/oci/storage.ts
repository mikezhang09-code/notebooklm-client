/**
 * OCI Object Storage client wrapper.
 *
 * Uses API-key authentication via ~/.oci/config; the user `nblm-corpus-app`
 * must be in the `research-corpus-admins` group with `manage object-family`
 * in the `research-corpus` compartment.
 */

import * as common from 'oci-common';
import * as objectstorage from 'oci-objectstorage';
import { Readable } from 'node:stream';
import type { CorpusConfig } from '../config.js';

let clientPromise: Promise<objectstorage.ObjectStorageClient> | null = null;

async function buildClient(cfg: CorpusConfig): Promise<objectstorage.ObjectStorageClient> {
  const provider = new common.ConfigFileAuthenticationDetailsProvider(
    cfg.ociConfigFile,
    cfg.ociProfile,
  );
  const client = new objectstorage.ObjectStorageClient({
    authenticationDetailsProvider: provider,
  });
  // Pin the region. ConfigFileAuthenticationDetailsProvider already reads
  // it from the config file, but explicit is safer.
  client.regionId = cfg.ociRegion;
  return client;
}

export async function getStorageClient(cfg: CorpusConfig): Promise<objectstorage.ObjectStorageClient> {
  if (!clientPromise) clientPromise = buildClient(cfg);
  return clientPromise;
}

/**
 * Upload bytes (Buffer or Readable) to Object Storage.
 * Returns the canonical URL path of the new object.
 */
export async function putObject(
  cfg: CorpusConfig,
  objectName: string,
  body: Buffer | Readable,
  contentType: string,
  contentLength?: number,
): Promise<{ objectName: string; etag?: string }> {
  const client = await getStorageClient(cfg);
  const computedLength =
    contentLength ?? (Buffer.isBuffer(body) ? body.length : undefined);
  if (computedLength === undefined) {
    throw new Error('contentLength is required when uploading a stream');
  }
  const response = await client.putObject({
    namespaceName: cfg.ociNamespace,
    bucketName: cfg.ociBucket,
    objectName,
    putObjectBody: body,
    contentLength: computedLength,
    contentType,
  });
  return { objectName, etag: response.eTag };
}

/**
 * Mint a short-lived, object-scoped pre-authenticated request (PAR) URL.
 * Anyone with the URL can read this single object until `expiresAt`.
 */
export async function createReadPar(
  cfg: CorpusConfig,
  objectName: string,
  expiresAt: Date,
  parName?: string,
): Promise<{ fullPath: string; expiresAt: Date }> {
  const client = await getStorageClient(cfg);
  const response = await client.createPreauthenticatedRequest({
    namespaceName: cfg.ociNamespace,
    bucketName: cfg.ociBucket,
    createPreauthenticatedRequestDetails: {
      name: parName ?? `read-${Date.now()}-${objectName.slice(-32)}`,
      objectName,
      accessType:
        objectstorage.models.CreatePreauthenticatedRequestDetails.AccessType
          .ObjectRead,
      timeExpires: expiresAt,
    },
  });
  const par = response.preauthenticatedRequest;
  if (!par.fullPath) {
    throw new Error('OCI did not return a fullPath for the PAR');
  }
  return { fullPath: par.fullPath, expiresAt };
}

/**
 * Health check — verifies bucket access by HEADing it. Cheapest possible
 * round-trip that exercises auth + network + IAM policy.
 */
export async function storageHealthCheck(cfg: CorpusConfig): Promise<{
  ok: boolean;
  bucket?: string;
  approxObjectCount?: number;
  error?: string;
}> {
  try {
    const client = await getStorageClient(cfg);
    const head = await client.headBucket({
      namespaceName: cfg.ociNamespace,
      bucketName: cfg.ociBucket,
    });
    // headBucket returns metadata in headers; for a richer signal call getBucket
    // which gives approximateCount. But getBucket is a heavier call — only do
    // it if headBucket succeeded.
    void head;
    const bucket = await client.getBucket({
      namespaceName: cfg.ociNamespace,
      bucketName: cfg.ociBucket,
      fields: [objectstorage.requests.GetBucketRequest.Fields.ApproximateCount],
    });
    return {
      ok: true,
      bucket: cfg.ociBucket,
      approxObjectCount: bucket.bucket.approximateCount,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
