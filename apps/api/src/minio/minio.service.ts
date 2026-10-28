import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Client as MinioClient } from 'minio';
import type { EnvironmentVariables } from '../config/env.validation';

/** Result of storing one object: the key to persist on EvidenceRecord plus the verified content hash. */
export interface StoredObject {
  objectKey: string;
  sha256: string;
}

/**
 * Thin wrapper over the MinIO (S3) client for file-evidence storage.
 *
 * Buffered, not streamed: evidence parts are small (the synthetic bundle's largest is < 1 KiB) and the
 * import's multipart parser already holds each part as a size-capped Buffer. Buffering lets us compute the
 * SHA-256 BEFORE the PUT, so the object's x-amz-meta-sha256 is the real digest (a streamed tee can't set
 * it until the stream drains) and it's a single PUT instead of multipart ceremony for a tiny file.
 *
 * The ETag returned by MinIO is MD5 (or a composite for multipart) — never a content hash. We compute and
 * store our own SHA-256 as the authority (also mirrored into EvidenceRecord.contentHash by the importer).
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const endpoint = new URL(config.get('MINIO_ENDPOINT', { infer: true }));
    this.client = new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
      secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
    });
    this.bucket = config.get('MINIO_BUCKET', { infer: true });
  }

  /** Ensure the evidence bucket exists (the compose minio-init sidecar also creates it idempotently). */
  async onModuleInit(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket "${this.bucket}"`);
    }
  }

  /**
   * Store an evidence object and return its key + verified SHA-256. The caller supplies a deterministic,
   * prefix-anchored key (imports/<batchId>/<ref>.<ext>) and an ext-derived content type — never a
   * client-supplied one — so a hostile ref can neither escape the batch prefix nor smuggle a served MIME type.
   */
  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.client.putObject(this.bucket, objectKey, body, body.length, {
      'Content-Type': contentType,
      'x-amz-meta-sha256': sha256,
    });
    return { objectKey, sha256 };
  }
}
